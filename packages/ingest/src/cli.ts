#!/usr/bin/env node
/**
 * CLI de ingesta de Artlas.
 *
 *   npm run ingest -- --dry-run                  ver qué haría, sin escribir
 *   npm run ingest -- --museum Q160112           solo el Prado
 *   npm run ingest -- --min-notability 10        solo obras muy conocidas
 *   npm run ingest -- --all --limit 500          catálogo completo, 500/museo
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createDb, refreshCounters } from './db.js';
import { DEFAULT_OPTIONS, ingestAll, SIN_CIFRAS, type PipelineOptions } from './pipeline.js';
import { RunLog } from './run-log.js';
import { retryCount } from './util/http.js';
import type { MuseumSeed } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Args {
  museums?: string[];
  options: Partial<PipelineOptions>;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { options: {}, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];

    switch (arg) {
      case '--help': case '-h':
        args.help = true;
        break;
      case '--museum': case '-m': {
        const qid = next();
        if (qid) (args.museums ??= []).push(qid);
        break;
      }
      case '--all':
        args.museums = undefined;
        break;
      /*
       * El barrido completo: todo lo que exista, con imagen o sin ella. Es lo
       * que llena la sala de espera —las 182.000 obras medidas frente a las
       * 6.000 que teníamos— y por eso es una bandera explícita y no el valor
       * por defecto: multiplica por treinta el tiempo de ingesta.
       */
      case '--everything':
        args.options.minNotability = 0;
        args.options.requireImage = false;
        args.options.limitPerMuseum = 100000;
        break;
      case '--min-notability':
        args.options.minNotability = Number(next());
        break;
      case '--limit':
        args.options.limitPerMuseum = Number(next());
        break;
      case '--batch-size':
        args.options.batchSize = Number(next());
        break;
      case '--dry-run':
        args.options.dryRun = true;
        break;
      case '--no-enrich':
        args.options.enrich = false;
        break;
      case '--force':
        args.options.force = true;
        break;
      default:
        if (arg?.startsWith('-')) {
          console.error(`Opción desconocida: ${arg}`);
          process.exit(1);
        }
    }
  }

  return args;
}

const HELP = `
Artlas · ingesta de obras de arte

  npm run ingest -- [opciones]

Opciones
  -m, --museum <QID>        Ingerir solo este museo (repetible)
      --all                 Todos los museos de la semilla (por defecto)
      --min-notability <n>  Mínimo de enlaces a Wikipedia. Por defecto ${DEFAULT_OPTIONS.minNotability}.
                            0 = todo (cientos de miles); 5 = catálogo curado;
                            15 = solo obras muy célebres.
      --everything          Todo lo que exista: sin umbral de notoriedad y
                            también las obras sin imagen, que se guardan
                            esperando datos. Multiplica por ~30 el tiempo.
      --limit <n>           Máximo de obras por museo. Por defecto ${DEFAULT_OPTIONS.limitPerMuseum}.
      --batch-size <n>      Filas por escritura. Por defecto ${DEFAULT_OPTIONS.batchSize}.
      --no-enrich           No consultar las APIs propias de los museos
                            (Met, AIC). Más rápido, imágenes peores.
      --dry-run             No escribe en la base de datos.
      --force               Reprocesa museos ya completados.
  -h, --help                Esta ayuda.

Antes de la primera ejecución
  1. Aplica supabase/migrations/0001_init.sql a tu proyecto Supabase.
  2. Copia .env.example a .env y rellena las credenciales.
  3. Genera la semilla de museos:  npx tsx src/build-seed.ts
`;

async function loadSeed(): Promise<MuseumSeed[]> {
  const path = join(HERE, '..', 'data', 'museums.seed.json');

  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return raw.museums as MuseumSeed[];
  } catch {
    throw new Error(
      'No se encuentra data/museums.seed.json. Genéralo con: npx tsx src/build-seed.ts',
    );
  }
}

/**
 * Rehace las estadísticas del planificador.
 *
 * Después de escribir 100.000 filas, Postgres sigue planificando como si la
 * tabla tuviera 6.000 hasta que autovacuum se entera, y mientras tanto elige
 * planes malos: la ficha de museo pasó a agotar el tiempo y "obras cerca de
 * mí" tardaba 1,5 s donde tarda 0,6. Un ANALYZE lo corrige en segundos.
 *
 * Va aquí y no en una herramienta aparte porque quien ensucia las estadísticas
 * es esta ingesta: dejarlo para que alguien se acuerde de ejecutarlo es dejar
 * la app lenta hasta que un usuario se queje.
 *
 * Necesita DATABASE_URL (conexión directa); PostgREST no ejecuta ANALYZE. Si no
 * está configurada se avisa y no se falla: la ingesta ya ha terminado bien.
 */
async function analyzeTables(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.log('  (sin DATABASE_URL: no se han rehecho las estadísticas del planificador)');
    return;
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log('Rehaciendo estadísticas del planificador…');
    for (const table of ['artworks', 'artwork_translations', 'artists', 'artist_translations']) {
      await client.query(`analyze ${table}`);
    }
  } catch (err) {
    console.warn(`  (no se pudieron rehacer: ${(err as Error).message})`);
  } finally {
    await client.end().catch(() => { /* ya cerrada */ });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    return;
  }

  const options: PipelineOptions = { ...DEFAULT_OPTIONS, ...args.options };

  const seed = await loadSeed();
  const museums = args.museums
    ? seed.filter((m) => args.museums!.includes(m.qid))
    : seed;

  if (museums.length === 0) {
    throw new Error(`Ningún museo coincide con: ${args.museums?.join(', ')}`);
  }

  // En dry-run ni siquiera pedimos credenciales: sirve para probar los
  // conectores sin tener Supabase montado.
  const db = options.dryRun ? null : createDb();

  console.log(`Artlas · ingesta de ${museums.length} museo(s)`);
  console.log(
    `Notoriedad mínima: ${options.minNotability} · ` +
    `Tope por museo: ${options.limitPerMuseum}` +
    `${options.dryRun ? ' · SIMULACIÓN (no escribe)' : ''}`,
  );

  const started = Date.now();

  /*
   * En simulación no se abre ejecución: el panel enseña lo que le PASA al
   * catálogo, y un ensayo que no escribe nada solo ensuciaría la lista con
   * filas que no significan nada.
   */
  const log = db ? await RunLog.open(db, process.argv.slice(2).join(' '), museums.length) : null;

  /*
   * Si esto revienta —o si alguien pulsa Ctrl+C—, la fila de la ejecución NO
   * puede quedarse diciendo `running`: ese es exactamente el estado en el que
   * se quedó la del 28 de agosto, y por el que el panel habría dicho «va bien»
   * durante catorce horas. Se cierra con el motivo, se hunda por donde se
   * hunda.
   */
  let stats = SIN_CIFRAS;

  const cerrarPorLaFuerza = async (motivo: string) => {
    await log?.close('failed', stats, new Error(motivo));
  };

  const alRecibirSenal = () => {
    console.log('\n■ Interrumpida a mano.');
    void log?.close('cancelled', stats).finally(() => process.exit(130));
  };
  process.once('SIGINT', alRecibirSenal);
  process.once('SIGTERM', alRecibirSenal);

  let cancelled = false;

  /*
   * TODO lo que va después de abrir la ejecución tiene que estar aquí dentro,
   * y no solo el barrido. Con el recálculo de contadores fuera, su excepción
   * salía por `main().catch()` y la fila se quedaba diciendo `running` hasta
   * que el enterrador la recogía diez minutos después: el panel enseñaba «en
   * curso» algo que ya no existía, que es justo lo que este registro vino a
   * impedir. Pasó el 29 de agosto de 2026, con este código recién escrito.
   */
  try {
    const outcome = await ingestAll(db, museums, options, log);
    stats = outcome.total;
    cancelled = outcome.cancelled;

    /*
     * Los contadores por museo/artista/movimiento se recalculan una sola vez
     * al final: son tres UPDATE de tabla completa y hacerlos por lote sería
     * absurdo.
     *
     * Y su fallo NO tumba la ingesta. También pasó el 29 de agosto: un barrido
     * escribió sus obras bien y acabó reportando fracaso porque el recálculo
     * agotó el `statement_timeout` —tres UPDATE sobre 148.000 filas están al
     * borde—. El catálogo estaba correcto y el resumen decía que no, que es la
     * clase de mentira que hace desconfiar de todo lo demás. Un contador
     * desfasado se arregla con `npm run refresh`; una ingesta dada por fallida
     * se rehace entera para nada.
     */
    if (db && stats.inserted > 0) {
      console.log('\nRecalculando contadores…');
      try {
        await refreshCounters(db);
        await analyzeTables();
      } catch (err) {
        console.warn(`  ⚠ no se pudieron recalcular: ${(err as Error).message}`);
        console.warn('    El catálogo está escrito. `npm run refresh` los rehace.');
      }
    }

    await log?.close(
      cancelled ? 'cancelled' : stats.errors > 0 ? 'failed' : 'done',
      stats,
      stats.errors > 0 ? new Error(`${stats.errors} museo(s) con error`) : null,
    );
  } catch (err) {
    await cerrarPorLaFuerza((err as Error).message);
    throw err;
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);

  console.log(`
──────────────────────────────────────────
  Descargadas   ${stats.fetched}
  Nuevas        ${stats.inserted}
  Actualizadas  ${stats.updated}
  Sin cambios   ${stats.unchanged}
  Publicadas    ${stats.published}
  Esperando     ${stats.pending}
  No son obras  ${stats.rejected}
  Duplicadas    ${stats.skipped}
  Corregidas    ${stats.repaired}
  Errores       ${stats.errors}
  Obras perdidas ${stats.lostWorks}${stats.lostWorks > 0 ? ` en ${stats.lostBatches} lotes` : ''}
  Reintentos    ${retryCount()}
  Tiempo        ${elapsed}s
──────────────────────────────────────────`);

  if (stats.lostWorks > 0) {
    console.log(`  ⚠ ${stats.lostWorks} obras no llegaron a mirarse: Wikidata falló en esos lotes`);
    console.log('  y agotó los reintentos. Los museos afectados quedaron marcados como');
    console.log('  incompletos y el próximo barrido los rehace solos.');
    console.log();
  }

  if (stats.pending > 0) {
    console.log(`  ${stats.pending} obras guardadas esperando datos. No se ven en la app todavía.`);
    console.log('  Cuando les llegue imagen o entren en dominio público, `npm run promote` las publica.');
    console.log();
  }

  /*
   * Si el panel se quedó ciego hay que decirlo AQUÍ, en el resumen, y no solo
   * en el momento del fallo: cuando esto se lee, el aviso de hace tres horas
   * está enterrado bajo mil líneas. Una ingesta que corrió sin dejar rastro
   * consultable es media ingesta.
   */
  if (log?.ciego) {
    console.log('  ⚠ El estado NO se pudo escribir en la base: esta ejecución no sale en el panel.');
    console.log();
  }

  if (stats.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`);
  process.exit(1);
});
