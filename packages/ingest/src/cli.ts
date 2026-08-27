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
import { DEFAULT_OPTIONS, ingestAll, type PipelineOptions } from './pipeline.js';
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
  const stats = await ingestAll(db, museums, options);

  // Los contadores por museo/artista/movimiento se recalculan una sola vez al
  // final: son tres UPDATE de tabla completa y hacerlos por lote sería absurdo.
  if (db && stats.inserted > 0) {
    console.log('\nRecalculando contadores…');
    await refreshCounters(db);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);

  console.log(`
──────────────────────────────────────────
  Descargadas   ${stats.fetched}
  Escritas      ${stats.inserted}
  Duplicadas    ${stats.skipped}
  Errores       ${stats.errors}
  Tiempo        ${elapsed}s
──────────────────────────────────────────`);

  if (stats.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`);
  process.exit(1);
});
