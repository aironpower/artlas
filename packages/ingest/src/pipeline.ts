/**
 * Orquestador de la ingesta.
 *
 * Recorre museos, descarga sus obras de Wikidata, las deduplica y las escribe
 * en lotes. Guarda un checkpoint por museo para poder reanudar: una ingesta
 * completa son horas de llamadas a APIs de terceros y no puede empezar de
 * cero cada vez que se cae la red.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchArtworks, fetchInstitution } from './sources/wikidata.js';
import { enrichBatch } from './sources/museum-apis.js';
import { DedupeIndex, mergeArtworks } from './normalize.js';
import { IdCache, refreshCounters, upsertArtworks } from './db.js';
import { classify } from './audit/gate.js';
import type { RunLog } from './run-log.js';
import type { CanonicalArtwork, IngestStats, MuseumSeed } from './types.js';

const CHECKPOINT_DIR = '.checkpoints';

export interface PipelineOptions {
  /** Mínimo de sitelinks. Es la palanca de curación del catálogo. */
  minNotability: number;
  /** Tope de obras por museo. */
  limitPerMuseum: number;
  /** Filas por escritura a Supabase. */
  batchSize: number;
  /** No escribe nada; solo informa de lo que haría. */
  dryRun: boolean;
  /** Reprocesa museos ya completados. */
  force: boolean;
  /** Consulta la API propia del museo para mejorar imagen y ficha. */
  enrich: boolean;
  /*
   * Si es false, también se traen las obras SIN imagen. Se guardan como
   * `pending`: existen, las conocemos, y esperan a que alguna fuente nos dé
   * una imagen que podamos enseñar. Para el arte del siglo XX son la mayoría.
   */
  requireImage: boolean;
}

/*
 * minNotability por defecto = 2, medido y no elegido a ojo.
 *
 * Obras alcanzables en los 47 museos de la semilla, según el umbral:
 *
 *   umbral 1  ->  ~10.200 obras     al menos una Wikipedia habla de ella
 *   umbral 2  ->   ~5.100 obras     <- por defecto
 *   umbral 3  ->   ~3.600 obras
 *   umbral 5  ->   ~2.200 obras
 *   umbral 8  ->   ~1.200 obras
 *
 * El objetivo del catálogo son 5.000-20.000 obras curadas, así que 2 es el
 * umbral más exigente que sigue llegando a esa cifra. Subir a 5 dejaba el
 * catálogo en 2.200, menos de la mitad de lo buscado.
 */
export const DEFAULT_OPTIONS: PipelineOptions = {
  minNotability: 2,
  limitPerMuseum: 2000,
  batchSize: 250,
  dryRun: false,
  force: false,
  enrich: true,
  requireImage: true,
};

/**
 * El checkpoint guarda con qué umbral se hizo el museo, y no solo cuántas
 * obras salieron.
 *
 * Sin eso, bajar `--min-notability` de 8 a 2 hacía que la ingesta saltara los
 * museos ya procesados por considerarlos completos, y el catálogo quedaba con
 * un museo a un umbral y el resto a otro, sin ningún aviso. Un checkpoint
 * hecho con un umbral MÁS ALTO se considera caducado, porque al bajar el
 * umbral entran obras nuevas; uno hecho con un umbral igual o más bajo ya
 * contiene todo lo que pediríamos ahora.
 */
interface Checkpoint {
  qid: string;
  count: number;
  minNotability: number;
  at: string;
  /**
   * Obras que se perdieron por lotes fallidos en esa pasada.
   *
   * Un museo al que le faltan obras NO está hecho, y darlo por hecho es peor
   * que haber abortado: el fallo queda enterrado en un fichero que nadie mira
   * y el museo no se vuelve a intentar jamás. Con esto, el siguiente barrido
   * lo rehace solo.
   */
  lost: number;
}

async function readCheckpoint(qid: string): Promise<Checkpoint | null> {
  try {
    const raw = await readFile(join(CHECKPOINT_DIR, `${qid}.json`), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Checkpoint>;

    if (typeof parsed.count !== 'number') return null;

    return {
      qid,
      count: parsed.count,
      // Los checkpoints antiguos no lo guardaban. Infinity los da por
      // caducados siempre, que es lo prudente.
      minNotability: parsed.minNotability ?? Number.POSITIVE_INFINITY,
      at: parsed.at ?? '',
      lost: parsed.lost ?? 0,
    };
  } catch {
    return null;
  }
}

async function writeCheckpoint(
  qid: string, count: number, minNotability: number, lost: number,
): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(
    join(CHECKPOINT_DIR, `${qid}.json`),
    JSON.stringify({ qid, count, minNotability, lost, at: new Date().toISOString() }),
    'utf8',
  );
}

/**
 * Cómo acabó un museo, además de sus cifras.
 *
 * Existe porque el panel necesita distinguir tres finales que en las cifras se
 * parecen: el museo que se saltó (ya estaba hecho), el que abortó, y el que
 * escribió obras pero perdió lotes. Antes esa diferencia solo estaba en el
 * texto que salía por consola, y un texto no se puede consultar.
 */
export interface MuseumOutcome {
  stats: IngestStats;
  /** Ya estaba hecho: no se tocó Wikidata siquiera. */
  skipped: boolean;
  /** Lo que lo tumbó, si lo hubo. */
  error: Error | null;
}

export async function ingestMuseum(
  db: SupabaseClient | null,
  cache: IdCache | null,
  museum: MuseumSeed,
  dedupe: DedupeIndex,
  options: PipelineOptions,
  log: RunLog | null = null,
): Promise<MuseumOutcome> {
  const stats: IngestStats = {
    fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0,
    published: 0, pending: 0, rejected: 0, repaired: 0,
    lostBatches: 0, lostWorks: 0,
  };

  if (!options.force) {
    const done = await readCheckpoint(museum.qid);

    if (done && done.minNotability <= options.minNotability && done.lost === 0) {
      console.log(`  ⏭  ${museum.name}: ya procesado (${done.count} obras). --force para rehacer.`);
      stats.skipped = done.count;
      return { stats, skipped: true, error: null };
    }

    if (done && done.lost > 0) {
      console.log(
        `  ↻  ${museum.name}: se rehace ` +
        `(la última pasada perdió ${done.lost} obras en lotes fallidos)`,
      );
    } else if (done) {
      console.log(
        `  ↻  ${museum.name}: se rehace ` +
        `(estaba al umbral ${done.minNotability}, ahora ${options.minNotability})`,
      );
    }
  }

  const institution = await fetchInstitution(museum.qid);
  if (!institution) {
    console.warn(`  ✗ ${museum.name} (${museum.qid}): sin datos en Wikidata`);
    stats.errors++;
    return { stats, skipped: false, error: new Error('sin datos en Wikidata') };
  }

  if (institution.lat === undefined) {
    // Sin coordenadas la obra no puede salir en el mapa, que es el producto.
    console.warn(`  ✗ ${institution.name}: sin coordenadas, se omite`);
    stats.errors++;
    return { stats, skipped: false, error: new Error('sin coordenadas en Wikidata') };
  }

  console.log(`  → ${institution.name} (${institution.city ?? '?'}, ${institution.country ?? '?'})`);

  let batch: CanonicalArtwork[] = [];
  let enriched = 0;

  const flush = async () => {
    if (batch.length === 0) return;

    /*
     * Segunda pasada contra la API del propio museo, si la tiene. Solo para
     * las obras a las que les falta algo que esa API pueda aportar: preguntar
     * por una que ya tiene imagen, técnica y medidas cuesta ocho segundos para
     * no cambiar nada.
     */
    if (options.enrich && museum.api) {
      enriched += await enrichBatch(batch, museum.api);
    }

    /*
     * El clasificador, antes de escribir. Ya no descarta nada: decide con qué
     * estado entra cada obra. Va aquí y no dentro de `upsertArtworks` porque
     * las reparaciones —quitar la autoría anónima, quitar una época de la lista
     * de movimientos— tienen que aplicarse ANTES de resolver las claves
     * foráneas; si no, se crearían el artista y el movimiento que acabamos de
     * decidir que no existen.
     */
    const gate = classify(batch);

    for (const row of gate.rows) {
      if (row.status === 'published') stats.published++;
      else if (row.status === 'pending') stats.pending++;
      else stats.rejected++;
    }
    stats.repaired += gate.repaired.length;

    if (options.dryRun) {
      stats.inserted += gate.rows.length;
    } else {
      const result = await upsertArtworks(db!, cache!, gate.rows);
      stats.inserted += result.inserted;
      stats.updated += result.updated;
    }

    batch = [];

    /*
     * El latido va aquí, por lote, y no solo al empezar y acabar el museo. Con
     * lo segundo, el Met —dos horas y media él solo— pasaría dos horas sin dar
     * señales y el vigilante lo daría por muerto a los diez minutos. De paso,
     * las cifras del museo en curso suben a la vista del panel en vez de
     * aparecer todas de golpe al final.
     */
    await log?.progress(stats);
  };

  /*
   * El museo que aborta NO se lleva sus cifras a la tumba.
   *
   * Antes, cualquier excepción de aquí dentro subía hasta `ingestAll`, y allí
   * el `catch` solo sabía el nombre del museo: las obras ya escritas y, peor,
   * las PERDIDAS, no se sumaban a los totales. El resumen final del barrido
   * del 29 de agosto de 2026 decía "Obras perdidas 0" con cuatro páginas
   * perdidas en el log, unas 2.000 obras. Un resumen que miente es peor que no
   * tener resumen, porque se le cree.
   *
   * Así que el fallo se atiende aquí, se cuenta, y el museo devuelve lo que sí
   * consiguió. Lo único que NO se hace al abortar es escribir el checkpoint:
   * sin él, el próximo barrido lo rehace entero.
   */
  let abortado: Error | null = null;

  try {
    for await (const raw of fetchArtworks(museum, institution, {
      minNotability: options.minNotability,
      limit: options.limitPerMuseum,
      requireImage: options.requireImage,

      // Un lote perdido ya no mata al museo, pero se dice en voz alta y cuenta:
      // más abajo impide que el checkpoint dé el museo por completo.
      onBatchError: (err, perdidas, fase) => {
        stats.lostBatches++;
        stats.lostWorks += perdidas;
        console.warn(`     ⚠ ${fase}: lote perdido (~${perdidas} obras): ${err.message}`);
      },
    })) {
      stats.fetched++;

      // Una obra puede figurar en dos museos (préstamos, colecciones compartidas)
      // o llegar dos veces por P195 y P276. La fusionamos en vez de duplicarla.
      const existing = dedupe.find(raw);
      if (existing) {
        Object.assign(existing, mergeArtworks(existing, raw));
        stats.skipped++;
        continue;
      }

      /*
       * El enriquecimiento ya NO se hace aquí, obra por obra. Se hacía, y era el
       * cuello de botella de la ingesta entera: 7,3 obras/min frente a las 172
       * de un museo sin API propia, 24 veces más lento. Ahora se hace por lotes
       * y con varias peticiones a la vez, justo antes de escribir.
       */
      dedupe.add(raw);
      batch.push(raw);

      if (batch.length >= options.batchSize) await flush();
    }

    await flush();
  } catch (err) {
    abortado = err as Error;
    stats.errors++;
    console.error(`  ✗ ${museum.name}: ${abortado.message}`);

    // Lo que ya estaba en el lote sí se guarda: son obras buenas y completas.
    await flush().catch(() => { /* si tampoco se puede escribir, se pierde */ });
  }

  // Contadores al terminar CADA museo, no solo al final de todo.
  //
  // `institutions_in_bbox` filtra por `artwork_count > 0`, así que un museo
  // con obras pero con el contador a cero no sale en el mapa. Refrescando solo
  // al final, una ingesta larga deja la app medio vacía mientras corre, y una
  // ingesta interrumpida la deja vacía del todo pese a tener los datos.
  // Son tres UPDATE de tabla completa por museo (48 veces, no 5.000), que a
  // esta escala cuesta milisegundos.
  if (db && stats.inserted > 0) {
    try {
      await refreshCounters(db);
    } catch (err) {
      // El catálogo ya está escrito; un contador desfasado no justifica
      // abortar el museo entero. Se recalcula al final de todos modos.
      console.warn(`     (no se pudieron refrescar los contadores: ${(err as Error).message})`);
    }
  }

  /*
   * El checkpoint solo si se ha escrito de verdad. En modo seco no se ha
   * guardado nada, así que marcar el museo como hecho es mentir: el siguiente
   * intento REAL se lo salta y el museo se queda fuera del catálogo sin que
   * nadie lo note. Pasó con el Palazzo Vecchio, y de no haberlo visto se
   * habría llevado por delante parte del barrido completo.
   */
  if (!options.dryRun && !abortado) {
    await writeCheckpoint(museum.qid, stats.inserted, options.minNotability, stats.lostWorks);
  }

  if (abortado) {
    console.warn(
      `     ⚠ ${museum.name} ABORTADO tras ${stats.inserted} obras` +
      `${stats.lostWorks > 0 ? ` y ${stats.lostWorks} perdidas` : ''}.` +
      ' Sin checkpoint: el próximo barrido lo rehace entero.',
    );
  } else if (stats.lostWorks > 0) {
    console.warn(
      `     ⚠ ${museum.name} queda INCOMPLETO: ${stats.lostWorks} obras en ` +
      `${stats.lostBatches} lotes fallidos. El próximo barrido lo rehace.`,
    );
  }

  console.log(
    `     ${stats.published} publicadas` +
    `${stats.pending > 0 ? `, ${stats.pending} esperando datos` : ''}` +
    `${stats.rejected > 0 ? `, ${stats.rejected} no son obras` : ''}` +
    `${stats.skipped > 0 ? `, ${stats.skipped} duplicadas` : ''}` +
    `${stats.repaired > 0 ? `, ${stats.repaired} corregidas` : ''}` +
    `${enriched > 0 ? `, ${enriched} enriquecidas vía ${museum.api}` : ''}`,
  );

  return { stats, skipped: false, error: abortado };
}

/** Lo que devuelve un barrido completo: sus totales y si lo pararon. */
export interface RunOutcome {
  total: IngestStats;
  /** Alguien pulsó «parar» en el panel y la ingesta salió por su propio pie. */
  cancelled: boolean;
}

export async function ingestAll(
  db: SupabaseClient | null,
  museums: MuseumSeed[],
  options: PipelineOptions,
  log: RunLog | null = null,
): Promise<RunOutcome> {
  const cache = db ? new IdCache(db) : null;
  const dedupe = new DedupeIndex();

  const total: IngestStats = {
    fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0,
    published: 0, pending: 0, rejected: 0, repaired: 0,
    lostBatches: 0, lostWorks: 0,
  };

  let cancelled = false;

  for (const [i, museum] of museums.entries()) {
    /*
     * Se pregunta ANTES de empezar el museo, no dentro. Cortar a mitad de un
     * museo lo deja sin checkpoint y el siguiente barrido lo rehace entero:
     * parar «ya mismo» costaría más trabajo del que ahorra.
     */
    if (await log?.cancelPedido()) {
      console.log(`\n■ Parada pedida desde el panel. Se deja tras ${i} museo(s).`);
      cancelled = true;
      break;
    }

    console.log(`\n[${i + 1}/${museums.length}] ${museum.name}`);
    await log?.startStep(i + 1, museum);

    try {
      const { stats, skipped, error } = await ingestMuseum(db, cache, museum, dedupe, options, log);

      total.fetched += stats.fetched;
      total.inserted += stats.inserted;
      total.updated += stats.updated;
      total.skipped += stats.skipped;
      total.errors += stats.errors;
      total.published += stats.published;
      total.pending += stats.pending;
      total.rejected += stats.rejected;
      total.repaired += stats.repaired;
      total.lostBatches += stats.lostBatches;
      total.lostWorks += stats.lostWorks;

      await log?.finishStep(stats, { skipped, error });
    } catch (err) {
      /*
       * Un museo que falla no debe tumbar una ingesta de horas. Lo que sí
       * cambia respecto a antes: el fallo queda escrito en su fila con el
       * motivo, en vez de vivir en una línea de log que nadie va a leer.
       */
      console.error(`  ✗ ${museum.name}: ${(err as Error).message}`);
      total.errors++;
      await log?.finishStep({ ...SIN_CIFRAS, errors: 1 }, { error: err as Error });
    }
  }

  return { total, cancelled };
}

/**
 * Cifras a cero.
 *
 * Para cerrar el paso de un museo que ni llegó a devolverlas, y para que el
 * resumen de una ejecución que se cae antes de empezar sea un cero honesto en
 * vez de un hueco.
 */
export const SIN_CIFRAS: IngestStats = {
  fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0,
  published: 0, pending: 0, rejected: 0, repaired: 0,
  lostBatches: 0, lostWorks: 0,
};
