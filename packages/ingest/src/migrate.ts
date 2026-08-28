#!/usr/bin/env node
/**
 * Aplicador de migraciones.
 *
 *   npm run migrate -- --status     qué está aplicado y qué falta
 *   npm run migrate -- --dry-run    ejecuta cada pendiente y hace ROLLBACK
 *   npm run migrate                 aplica las pendientes de verdad
 *   npm run migrate -- --seed       marca las existentes como ya aplicadas
 *
 * Por qué no `supabase db push`: la CLI espera nombres con marca de tiempo
 * (`20260828143000_x.sql`) y lleva su cuenta en una tabla suya. Las diez
 * primeras migraciones de este proyecto se aplicaron a mano desde el editor
 * SQL, así que no constan ahí: un `db push` intentaría reaplicarlas desde
 * `0001_init.sql` y reventaría creando tablas que ya existen.
 *
 * Lo que más falta hacía es `--dry-run`. Cada sentencia va dentro de una
 * transacción, así que ejecutar y deshacer dice si una migración funciona SIN
 * aplicarla. La 0009 se cayó por un `create or replace function` que cambiaba
 * el tipo de retorno, y como el editor SQL envuelve todo en una transacción,
 * la migración entera se deshizo en silencio: todo parecía correcto y no se
 * había aplicado nada. Eso se caza aquí en dos segundos.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', '..', '..', 'supabase', 'migrations');

interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  return Promise.all(files.map(async (file) => {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    return {
      version: file.split('_')[0] ?? file,
      name: file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
    };
  }));
}

/**
 * Conecta, prefiriendo verificar el certificado del servidor.
 *
 * Si la cadena de confianza de Supabase no está en el almacén de Node, se
 * reintenta sin verificarla y SE AVISA: la conexión sigue cifrada, pero deja
 * de estar protegida contra un intermediario. Es una degradación real y por
 * eso se dice en voz alta en vez de ponerlo por defecto y callar.
 */
async function connect(url: string): Promise<pg.Client> {
  for (const [strict, aviso] of [[true, ''], [false, 'SIN verificar el certificado del servidor']] as const) {
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: strict },
      connectionTimeoutMillis: 15000,
    });

    try {
      await client.connect();
      if (aviso) console.warn(`  ⚠ conectado ${aviso}`);
      return client;
    } catch (err) {
      try { await client.end(); } catch { /* ya estaba caída */ }
      if (strict && /certificate|self.signed|SSL/i.test((err as Error).message)) continue;
      throw err;
    }
  }

  throw new Error('no se pudo conectar');
}

const args = process.argv.slice(2);
const modo = args.includes('--seed') ? 'seed'
  : args.includes('--status') ? 'status'
  : args.includes('--dry-run') ? 'dry-run'
  : 'apply';

/*
 * `--only 0018 0019` aplica solo esas y deja el resto pendiente.
 *
 * Nació de una necesidad concreta: con una ingesta escribiendo en `artworks`,
 * una migración que hace ALTER TABLE sobre esa tabla conviene esperarla, pero
 * otra que solo redefine funciones de lectura no. Sin esta opción había que
 * elegir entre aplicarlas todas o ninguna.
 */
const soloIdx = args.indexOf('--only');
const solo = soloIdx === -1 ? null
  : new Set(args.slice(soloIdx + 1).filter((a) => !a.startsWith('--')));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    '\nFalta DATABASE_URL en el .env de la raíz.\n' +
    'Supabase > Connect > Session pooler > URI. El host directo\n' +
    '(db.<ref>.supabase.co) solo tiene IPv6 y no sirve desde aquí.\n',
  );
  process.exit(1);
}

const migrations = await loadMigrations();
const db = await connect(url);

try {
  await db.query(`
    create table if not exists applied_migrations (
      version    text primary key,
      name       text not null,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`);

  const { rows } = await db.query<{ version: string; checksum: string }>(
    'select version, checksum from applied_migrations');
  const aplicadas = new Map(rows.map((r) => [r.version, r.checksum]));

  const pendientes = migrations
    .filter((m) => !aplicadas.has(m.version))
    .filter((m) => !solo || solo.has(m.version));

  // --- Estado --------------------------------------------------------------
  if (modo === 'status') {
    console.log('\nMigraciones\n');
    for (const m of migrations) {
      const previa = aplicadas.get(m.version);
      const marca = previa === undefined ? '·  pendiente'
        : previa === m.checksum ? '✓  aplicada'
        : '⚠  aplicada, pero el fichero ha CAMBIADO desde entonces';
      console.log(`  ${marca.padEnd(52)} ${m.name}`);
    }
    console.log(`\n${aplicadas.size} aplicadas, ${pendientes.length} pendientes.\n`);
    process.exit(0);
  }

  // --- Sembrar -------------------------------------------------------------
  if (modo === 'seed') {
    if (pendientes.length === 0) {
      console.log('\nNo hay nada que sembrar.\n');
      process.exit(0);
    }

    console.log('\nMarcando como aplicadas SIN ejecutarlas:');
    for (const m of pendientes) {
      await db.query(
        'insert into applied_migrations (version, name, checksum) values ($1, $2, $3)',
        [m.version, m.name, m.checksum],
      );
      console.log(`  ✓ ${m.name}`);
    }
    console.log('\nUsar esto solo con migraciones que YA se aplicaron a mano.\n');
    process.exit(0);
  }

  // --- Aplicar / ensayar ---------------------------------------------------
  if (pendientes.length === 0) {
    console.log('\nTodo al día: no hay migraciones pendientes.\n');
    process.exit(0);
  }

  const ensayo = modo === 'dry-run';
  console.log(`\n${pendientes.length} pendiente(s)${ensayo ? ' — ENSAYO, se deshace todo al final' : ''}\n`);

  let fallos = 0;

  for (const m of pendientes) {
    process.stdout.write(`  ${m.name.padEnd(40)}`);

    try {
      await db.query('begin');
      await db.query(m.sql);

      if (ensayo) {
        await db.query('rollback');
        console.log('✓ funcionaría');
      } else {
        await db.query(
          'insert into applied_migrations (version, name, checksum) values ($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
        await db.query('commit');
        console.log('✓ aplicada');
      }
    } catch (err) {
      await db.query('rollback').catch(() => { /* la transacción ya estaba abortada */ });
      console.log('✗ FALLA');
      console.log(`      ${(err as Error).message}`);
      fallos++;

      // Se para en la primera que falla: las siguientes suelen depender de
      // ella, y encadenar errores solo entierra el que importa.
      break;
    }
  }

  console.log(fallos === 0
    ? (ensayo ? '\nTodas funcionarían.\n' : '\nAplicadas.\n')
    : '\nDetenido en la primera que falla.\n');

  process.exitCode = fallos === 0 ? 0 : 1;
} finally {
  await db.end();
}
