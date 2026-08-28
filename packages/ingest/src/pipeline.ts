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
    };
  } catch {
    return null;
  }
}

async function writeCheckpoint(
  qid: string, count: number, minNotability: number,
): Promise<void> {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  await writeFile(
    join(CHECKPOINT_DIR, `${qid}.json`),
    JSON.stringify({ qid, count, minNotability, at: new Date().toISOString() }),
    'utf8',
  );
}

export async function ingestMuseum(
  db: SupabaseClient | null,
  cache: IdCache | null,
  museum: MuseumSeed,
  dedupe: DedupeIndex,
  options: PipelineOptions,
): Promise<IngestStats> {
  const stats: IngestStats = {
    fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0,
    published: 0, pending: 0, rejected: 0, repaired: 0,
  };

  if (!options.force) {
    const done = await readCheckpoint(museum.qid);

    if (done && done.minNotability <= options.minNotability) {
      console.log(`  ⏭  ${museum.name}: ya procesado (${done.count} obras). --force para rehacer.`);
      stats.skipped = done.count;
      return stats;
    }

    if (done) {
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
    return stats;
  }

  if (institution.lat === undefined) {
    // Sin coordenadas la obra no puede salir en el mapa, que es el producto.
    console.warn(`  ✗ ${institution.name}: sin coordenadas, se omite`);
    stats.errors++;
    return stats;
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
  };

  for await (const raw of fetchArtworks(museum, institution, {
    minNotability: options.minNotability,
    limit: options.limitPerMuseum,
    requireImage: options.requireImage,
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
  if (!options.dryRun) {
    await writeCheckpoint(museum.qid, stats.inserted, options.minNotability);
  }

  console.log(
    `     ${stats.published} publicadas` +
    `${stats.pending > 0 ? `, ${stats.pending} esperando datos` : ''}` +
    `${stats.rejected > 0 ? `, ${stats.rejected} no son obras` : ''}` +
    `${stats.skipped > 0 ? `, ${stats.skipped} duplicadas` : ''}` +
    `${stats.repaired > 0 ? `, ${stats.repaired} corregidas` : ''}` +
    `${enriched > 0 ? `, ${enriched} enriquecidas vía ${museum.api}` : ''}`,
  );

  return stats;
}

export async function ingestAll(
  db: SupabaseClient | null,
  museums: MuseumSeed[],
  options: PipelineOptions,
): Promise<IngestStats> {
  const cache = db ? new IdCache(db) : null;
  const dedupe = new DedupeIndex();

  const total: IngestStats = {
    fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0,
    published: 0, pending: 0, rejected: 0, repaired: 0,
  };

  for (const [i, museum] of museums.entries()) {
    console.log(`\n[${i + 1}/${museums.length}] ${museum.name}`);

    try {
      const stats = await ingestMuseum(db, cache, museum, dedupe, options);
      total.fetched += stats.fetched;
      total.inserted += stats.inserted;
      total.updated += stats.updated;
      total.skipped += stats.skipped;
      total.errors += stats.errors;
      total.published += stats.published;
      total.pending += stats.pending;
      total.rejected += stats.rejected;
      total.repaired += stats.repaired;
    } catch (err) {
      // Un museo que falla no debe tumbar una ingesta de horas.
      console.error(`  ✗ ${museum.name}: ${(err as Error).message}`);
      total.errors++;
    }
  }

  return total;
}
