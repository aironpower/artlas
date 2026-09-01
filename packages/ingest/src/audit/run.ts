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
import { checkImagesBatched } from './images.js';
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
 * 10.000 imágenes por pasada.
 *
 * Era 800 cuando cada imagen costaba una descarga y Wikimedia nos limitaba a
 * una cada tres segundos. Preguntando a su API de 50 en 50 son 200 peticiones y
 * un par de minutos, así que el presupuesto puede subir dos órdenes de
 * magnitud. Sigue habiendo tope, y por la misma razón de antes: `audit` marca
 * lo comprobado AL TERMINAR la pasada, así que una pasada que se caiga a mitad
 * tira su trabajo. Con 10.000 se pierde un par de minutos, no una noche.
 */
const DEFAULT_IMAGE_BUDGET = 10_000;

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

    /*
     * Con reintento, porque una página puede caerse por `statement timeout` sin
     * que haya nada roto: son 270 peticiones seguidas sobre 269.000 filas y
     * basta que la base esté ocupada —un autovacuum, el UPDATE con el que la
     * pasada anterior marcó 10.000 imágenes— para que una pase de los 3 s del
     * rol. Pasó el 1 de septiembre de 2026 y tiró una pasada entera de
     * imágenes que no tenía nada que ver con la lectura.
     */
    let data: unknown[] | null = null;

    for (const espera of [0, 2000, 8000, 20000]) {
      if (espera) await new Promise((r) => setTimeout(r, espera));

      const intento = await db.from(table).select(columns).order('id').range(from, to);
      if (!intento.error) { data = intento.data; break; }

      if (espera === 20000) throw new Error(`${table}: ${intento.error.message}`);
      console.log(`  (reintentando ${table} ${from}-${to}: ${intento.error.message})`);
    }

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
  /*
   * Y se pide por páginas, porque PostgREST devuelve 1.000 filas como mucho.
   * Con un `.limit(3000)` a secas la orden se aceptaba sin rechistar y la
   * pasada comprobaba mil: el presupuesto mentía en silencio, que es la peor
   * forma de mentir. Se vio el 1 de septiembre de 2026 leyendo la traza, no
   * por ningún error.
   *
   * El desempate por `id` no es adorno: sin él, ordenar por una columna que es
   * nula en decenas de miles de filas deja el orden a criterio del planificador
   * y dos páginas seguidas pueden repetir obras y saltarse otras.
   */
  const pendientes: { id: number; image_url: string; image_checked_at: string | null }[] = [];

  for (let desde = 0; desde < args.imageBudget; desde += PAGE) {
    const hasta = Math.min(desde + PAGE, args.imageBudget) - 1;

    const { data, error: errPend } = await db
      .from('artworks')
      .select('id, image_url, image_checked_at')
      .not('image_url', 'is', null)
      .order('image_checked_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(desde, hasta);

    if (errPend) throw new Error(`imágenes por comprobar: ${errPend.message}`);
    if (!data?.length) break;

    pendientes.push(...(data as typeof pendientes));
    if (data.length < hasta - desde + 1) break;
  }

  const cola = pendientes as { id: number; image_url: string }[];
  const nunca = pendientes.filter((w) => !w.image_checked_at).length;

  console.log(`\nComprobando ${cola.length} imágenes (${nunca} nunca vistas).`);
  console.log(`Preguntando a Commons de 50 en 50; lo que no es suyo, una a una.\n`);

  const checks = await checkImagesBatched(cola, userAgent, (done, total) => {
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

/*
 * Tres reglas se cuentan pero NO se guardan fila a fila.
 *
 * `image_missing`, `artist_missing` y `date_missing` daban 275.885 de los
 * 276.227 hallazgos y ocupaban 121 MB —59 de tabla y 62 de índices— de los 500
 * del plan. Y no dicen nada que el catálogo no diga ya: `image_missing` es
 * literalmente `status = 'pending'` sin `image_url`, y las otras dos son un
 * `is null` sobre su columna. Se estaba pagando el 24% de la base por guardar
 * un dato duplicado.
 *
 * Siguen apareciendo en el resumen, que es donde sirven: como cifra que dice
 * cuánto falta. Lo que desaparece es la fila por obra, que nadie iba a revisar
 * de una en una —había 0 hallazgos con `reviewed_by` en 276.227—.
 *
 * La bandeja se queda con lo que sí pide mirada humana: un título que es una
 * URL, una imagen que no carga, un año imposible, un movimiento duplicado.
 */
const NO_SE_GUARDAN = new Set(['image_missing', 'artist_missing', 'date_missing']);

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
  const soloCuenta = NO_SE_GUARDAN.has(rule) ? '  (solo se cuenta)' : '';
  console.log(`  ${info.severity.padEnd(8)} ${String(info.n).padStart(6)}  ${rule}${soloCuenta}`);
  console.log(`                     p. ej.: ${info.ejemplo.slice(0, 90)}`);
}

if (args.dryRun) {
  console.log('\nModo seco: no se ha escrito nada.\n');
  process.exit(0);
}

// --- Escritura --------------------------------------------------------------

const guardables = findings.filter((f) => !NO_SE_GUARDAN.has(f.rule));
for (const regla of NO_SE_GUARDAN) rulesRun.delete(regla);

/*
 * `status` NO va en el payload, y es deliberado. PostgREST convierte el upsert
 * en un ON CONFLICT DO UPDATE de las columnas que se envían: al omitirlo, un
 * hallazgo nuevo nace 'open' por el valor por defecto, y uno que ya existía
 * conserva el estado que le puso una persona. Si se enviara, cada pasada
 * devolvería a 'open' todo lo que hubieras descartado y la bandeja no
 * convergería nunca.
 */
const payload = guardables.map((f) => ({
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
