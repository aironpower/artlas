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
import { applyEnrichment, enrich } from './sources/museum-apis.js';
import { DedupeIndex, mergeArtworks } from './normalize.js';
import { IdCache, refreshCounters, upsertArtworks } from './db.js';
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
  const stats: IngestStats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };

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

  const flush = async () => {
    if (batch.length === 0) return;

    if (options.dryRun) {
      stats.inserted += batch.length;
    } else {
      const result = await upsertArtworks(db!, cache!, batch);
      stats.inserted += result.inserted;
      stats.updated += result.updated;
    }
    batch = [];
  };

  let enriched = 0;

  for await (const raw of fetchArtworks(museum, institution, {
    minNotability: options.minNotability,
    limit: options.limitPerMuseum,
    requireImage: true,
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

    let work = raw;

    // Segunda pasada contra la API del propio museo, si la tiene. Solo aplica
    // a los museos marcados con `api` en la semilla; para el resto la única
    // fuente es Wikidata. Un fallo aquí no invalida la obra: se guarda con los
    // datos de Wikidata, que ya son suficientes para la ficha.
    if (options.enrich && museum.api) {
      try {
        const extra = await enrich(work, museum.api);
        if (extra) {
          work = applyEnrichment(work, extra);
          enriched++;
        }
      } catch {
        // Silencioso a propósito: enriquecer es opcional y las APIs de museo
        // fallan a menudo. Ensuciar el log con esto ocultaría errores reales.
      }
    }

    dedupe.add(work);
    batch.push(work);

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

  await writeCheckpoint(museum.qid, stats.inserted, options.minNotability);

  console.log(
    `     ${stats.inserted} obras` +
    `${stats.skipped > 0 ? `, ${stats.skipped} duplicadas` : ''}` +
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

  const total: IngestStats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };

  for (const [i, museum] of museums.entries()) {
    console.log(`\n[${i + 1}/${museums.length}] ${museum.name}`);

    try {
      const stats = await ingestMuseum(db, cache, museum, dedupe, options);
      total.fetched += stats.fetched;
      total.inserted += stats.inserted;
      total.updated += stats.updated;
      total.skipped += stats.skipped;
      total.errors += stats.errors;
    } catch (err) {
      // Un museo que falla no debe tumbar una ingesta de horas.
      console.error(`  ✗ ${museum.name}: ${(err as Error).message}`);
      total.errors++;
    }
  }

  return total;
}
