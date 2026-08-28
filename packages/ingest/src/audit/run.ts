#!/usr/bin/env node
/**
 * Auditor del catálogo.
 *
 *   npm run audit                    reglas sin red, catálogo entero
 *   npm run audit -- --images        además comprueba que cada imagen carga
 *   npm run audit -- --limit 200     solo las 200 primeras obras (prueba rápida)
 *   npm run audit -- --dry-run       informa sin escribir en audit_findings
 *
 * Lo que encuentra va a `audit_findings`, una fila por regla y entidad. Se
 * puede reejecutar tantas veces como se quiera: actualiza en vez de duplicar.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createDb } from '../db.js';
import { auditArtist, auditArtwork, auditMovements } from './rules.js';
import { checkImages } from './images.js';
import type { ArtistRow, ArtworkRow, Finding, MovementRow } from './types.js';

const PAGE = 1000;   // tope de filas por petición de PostgREST

interface Args {
  images: boolean;
  /** Cuántas imágenes comprobar como mucho en esta pasada. */
  imageBudget: number;
  dryRun: boolean;
  limit?: number;
}

/*
 * 800 imágenes por pasada, no las 182.000 de golpe.
 *
 * A dos peticiones cada 400 ms son unos tres minutos: una espera razonable y
 * una carga razonable para Commons. Como se piden siempre las más antiguas sin
 * comprobar, pasadas sucesivas cubren el catálogo entero sin que ninguna dure
 * horas ni acabe limitada por ritmo.
 */
const DEFAULT_IMAGE_BUDGET = 800;

function parseArgs(argv: string[]): Args {
  const args: Args = { images: false, imageBudget: DEFAULT_IMAGE_BUDGET, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--images': args.images = true; break;
      case '--image-budget': args.imageBudget = Number(argv[++i]); break;
      case '--dry-run': args.dryRun = true; break;
      case '--limit': args.limit = Number(argv[++i]); break;
      case '--help': case '-h':
        console.log('uso: npm run audit -- [--images] [--image-budget N] [--limit N] [--dry-run]');
        process.exit(0);
    }
  }

  return args;
}

/** Lee una tabla entera saltando el tope de 1.000 filas de PostgREST. */
async function readAll<T>(
  db: SupabaseClient, table: string, columns: string, limit?: number,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE) {
    const to = Math.min(from + PAGE - 1, (limit ?? Infinity) - 1);
    if (to < from) break;

    const { data, error } = await db.from(table).select(columns).order('id').range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;

    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
    if (limit && rows.length >= limit) break;
  }

  return rows;
}

const args = parseArgs(process.argv.slice(2));
const db = createDb();
const startedAt = new Date().toISOString();
const userAgent = process.env.WIKIDATA_USER_AGENT ?? 'artlas-audit';

console.log(`\nAuditoría del catálogo${args.limit ? ` (limitada a ${args.limit} obras)` : ''}`);
if (args.dryRun) console.log('MODO SECO: no se escribe nada.\n');

// --- Lectura ----------------------------------------------------------------

const artworks = await readAll<ArtworkRow>(db, 'artworks',
  'id, title, image_url, artist_id, institution_id, year_start, year_end, date_display, notability',
  args.limit);
const artists = await readAll<ArtistRow>(db, 'artists', 'id, name, wikidata_qid, artwork_count');
const movements = await readAll<MovementRow>(db, 'movements', 'id, name, wikidata_qid, artwork_count');

console.log(`Leídas ${artworks.length} obras, ${artists.length} artistas, ${movements.length} movimientos.`);

// --- Reglas sin red ---------------------------------------------------------

const findings: Finding[] = [];
const rulesRun = new Set<string>([
  'image_missing', 'image_is_vector', 'institution_missing',
  'artist_missing', 'title_is_url', 'year_implausible', 'date_missing',
  'name_is_url', 'no_wikidata_qid',
  'movement_is_period', 'movement_no_qid', 'movement_duplicate',
]);

for (const work of artworks) findings.push(...auditArtwork(work));
for (const artist of artists) findings.push(...auditArtist(artist));
findings.push(...auditMovements(movements));

// --- Regla con red ----------------------------------------------------------

if (args.images) {
  /*
   * Solo las que no se han comprobado nunca, y las más antiguas primero. Esto
   * es lo que convierte una pasada imposible (182.000 peticiones) en una
   * rutina de tres minutos que, repetida, acaba cubriéndolo todo.
   */
  const { data: pendientes, error: errPend } = await db
    .from('artworks')
    .select('id, image_url, image_checked_at')
    .not('image_url', 'is', null)
    .order('image_checked_at', { ascending: true, nullsFirst: true })
    .limit(args.imageBudget);

  if (errPend) throw new Error(`imágenes por comprobar: ${errPend.message}`);

  const cola = (pendientes ?? []) as { id: number; image_url: string }[];
  const nunca = (pendientes ?? []).filter((w) => !w.image_checked_at).length;

  console.log(`\nComprobando ${cola.length} imágenes (${nunca} nunca vistas).`);
  console.log(`Despacio a propósito: dos a la vez. Un 429 no cuenta como imagen rota.\n`);

  const checks = await checkImages(cola, userAgent, (done, total) => {
    if (done % 100 === 0 || done === total) process.stdout.write(`  ${done}/${total}
`);
  });

  let ok = 0, broken = 0, unknown = 0;
  const comprobadas: number[] = [];

  for (const [id, check] of checks) {
    if (check.verdict === 'unknown') { unknown++; continue; }

    // Solo se marca como comprobada si hubo veredicto. Un 429 deja la obra en
    // la cola para la pasada siguiente, que es exactamente lo que queremos.
    comprobadas.push(id);

    if (check.verdict === 'ok') { ok++; continue; }

    broken++;
    findings.push({
      entityType: 'artwork', entityId: id,
      rule: 'image_unfetchable', severity: 'error', detail: check.detail,
    });
  }

  rulesRun.add('image_unfetchable');
  console.log(`\n  imágenes: ${ok} correctas, ${broken} rotas, ${unknown} sin veredicto.`);

  if (!args.dryRun && comprobadas.length > 0) {
    for (let i = 0; i < comprobadas.length; i += 500) {
      const { error } = await db.from('artworks')
        .update({ image_checked_at: startedAt })
        .in('id', comprobadas.slice(i, i + 500));
      if (error) throw new Error(`marcando comprobadas: ${error.message}`);
    }
  }

  const { count: sinVer } = await db.from('artworks')
    .select('*', { count: 'exact', head: true })
    .not('image_url', 'is', null).is('image_checked_at', null);

  if (sinVer) console.log(`  quedan ${sinVer} imágenes por comprobar en pasadas futuras.`);
}

// --- Resumen ----------------------------------------------------------------

const porRegla = new Map<string, { severity: string; n: number; ejemplo: string }>();
for (const f of findings) {
  const actual = porRegla.get(f.rule);
  if (actual) actual.n++;
  else porRegla.set(f.rule, { severity: f.severity, n: 1, ejemplo: f.detail });
}

const orden = { error: 0, warning: 1, info: 2 } as Record<string, number>;
const filas = [...porRegla.entries()].sort(
  (a, b) => (orden[a[1].severity]! - orden[b[1].severity]!) || b[1].n - a[1].n);

console.log(`\n${findings.length} hallazgos:\n`);
for (const [rule, info] of filas) {
  console.log(`  ${info.severity.padEnd(8)} ${String(info.n).padStart(5)}  ${rule}`);
  console.log(`                    p. ej.: ${info.ejemplo.slice(0, 90)}`);
}

if (args.dryRun) {
  console.log('\nModo seco: no se ha escrito nada.\n');
  process.exit(0);
}

// --- Escritura --------------------------------------------------------------

/*
 * `status` NO va en el payload, y es deliberado. PostgREST convierte el upsert
 * en un ON CONFLICT DO UPDATE de las columnas que se envían: al omitirlo, un
 * hallazgo nuevo nace 'open' por el valor por defecto, y uno que ya existía
 * conserva el estado que le puso una persona. Si se enviara, cada pasada
 * devolvería a 'open' todo lo que hubieras descartado y la bandeja no
 * convergería nunca.
 */
const payload = findings.map((f) => ({
  entity_type: f.entityType,
  entity_id: f.entityId,
  rule: f.rule,
  severity: f.severity,
  detail: f.detail,
  last_seen: startedAt,
}));

for (let i = 0; i < payload.length; i += 500) {
  const { error } = await db.from('audit_findings')
    .upsert(payload.slice(i, i + 500), { onConflict: 'entity_type,entity_id,rule' });
  if (error) throw new Error(`escribiendo hallazgos: ${error.message}`);
}

console.log(`\nEscritos ${payload.length} hallazgos.`);

/*
 * Cerrar lo que ya no se detecta.
 *
 * Solo se cierran hallazgos de las reglas que ESTA pasada ha ejecutado: sin ese
 * filtro, un `npm run audit` sin `--images` daría por arregladas todas las
 * imágenes rotas simplemente por no haberlas mirado.
 *
 * Y solo en una pasada completa: con `--limit` no se ha visto el catálogo
 * entero, así que no se puede afirmar que nada haya desaparecido.
 *
 * `dismissed` se queda como está. Es la promesa de la bandeja: lo que un
 * humano descarta no vuelve.
 */
if (!args.limit) {
  const { data: cerrados, error } = await db.from('audit_findings')
    .update({ status: 'fixed' })
    .in('status', ['open', 'confirmed'])
    .in('rule', [...rulesRun])
    .lt('last_seen', startedAt)
    .select('id');

  if (error) throw new Error(`cerrando hallazgos: ${error.message}`);
  if (cerrados?.length) console.log(`Cerrados ${cerrados.length} que ya no se detectan.`);
}

console.log();
