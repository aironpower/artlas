#!/usr/bin/env node
/**
 * Fusiona movimientos duplicados y aparta los que no son movimientos.
 *
 *   npm run merge-movements              enseña qué haría, sin tocar nada
 *   npm run merge-movements -- --apply   lo hace
 *
 * Por defecto NO escribe: mueve obras entre categorías y borra filas, y eso se
 * mira antes de ejecutarlo.
 *
 * Usa `movementRoot` e `isPeriodName` de `audit/rules.ts`, las mismas
 * funciones con las que el auditor detecta el problema y con las que la puerta
 * de entrada evita crear más. Reescribir aquí una versión en SQL habría dado
 * dos criterios que mantener de acuerdo.
 */

import pg from 'pg';
import { isPeriodName, movementRoot } from './audit/rules.js';

interface Movement {
  id: number;
  name: string;
  slug: string;
  wikidata_qid: string | null;
  artwork_count: number;
}

const aplicar = process.argv.includes('--apply');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\nFalta DATABASE_URL en el .env de la raíz.\n');
  process.exit(1);
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

try {
  const { rows: movements } = await db.query<Movement>(
    'select id, name, slug, wikidata_qid, artwork_count from movements');

  console.log(`\n${movements.length} movimientos en el catálogo.`);
  if (!aplicar) console.log('MODO SECO: no se escribe nada. Añade --apply para ejecutarlo.\n');

  // --- 1. Los que no son movimientos, sino épocas ---------------------------
  const epocas = movements.filter((m) => isPeriodName(m.name));

  console.log(`\nÉpocas coladas como movimientos: ${epocas.length}`);
  for (const m of epocas) {
    console.log(`  "${m.name}" (${m.artwork_count} obras) — se elimina`);
  }

  // --- 2. Familias que son el mismo movimiento ------------------------------
  const familias = new Map<string, Movement[]>();

  for (const m of movements) {
    if (isPeriodName(m.name)) continue;
    const root = movementRoot(m.name);
    if (root.length < 4) continue;
    familias.set(root, [...(familias.get(root) ?? []), m]);
  }

  const duplicadas = [...familias.values()].filter((f) => f.length > 1);

  console.log(`\nFamilias duplicadas: ${duplicadas.length}`);

  /*
   * El canónico es el que más obras tiene; a igualdad, el que tiene QID de
   * Wikidata. Fusionar hacia el mayor mueve menos filas y conserva el nombre
   * que ya usaba la mayoría del catálogo.
   */
  const plan: { canonical: Movement; absorbidos: Movement[] }[] = [];

  for (const familia of duplicadas) {
    const ordenada = [...familia].sort((a, b) =>
      b.artwork_count - a.artwork_count
      || Number(Boolean(b.wikidata_qid)) - Number(Boolean(a.wikidata_qid)));

    const [canonical, ...absorbidos] = ordenada;
    if (!canonical || absorbidos.length === 0) continue;

    plan.push({ canonical, absorbidos });
    console.log(`  ${canonical.name} (${canonical.artwork_count})`);
    for (const a of absorbidos) console.log(`      ← ${a.name} (${a.artwork_count})`);
  }

  if (!aplicar) {
    const obras = plan.reduce((s, p) => s + p.absorbidos.reduce((t, a) => t + a.artwork_count, 0), 0);
    console.log(`\nSe reasignarían ~${obras} obras y se eliminarían ` +
      `${plan.reduce((s, p) => s + p.absorbidos.length, 0) + epocas.length} filas.\n`);
    process.exit(0);
  }

  // --- 3. Ejecutar ----------------------------------------------------------
  await db.query('begin');

  let reasignadas = 0;

  for (const { canonical, absorbidos } of plan) {
    for (const dup of absorbidos) {
      /*
       * Mover los enlaces evitando chocar con los que ya existen: una obra
       * puede estar etiquetada a la vez como "Baroque" y "Baroque painting",
       * y la clave primaria de artwork_movements es (artwork_id, movement_id).
       */
      const movidas = await db.query(
        `update artwork_movements am
            set movement_id = $1
          where am.movement_id = $2
            and not exists (
              select 1 from artwork_movements otra
               where otra.artwork_id = am.artwork_id and otra.movement_id = $1
            )`,
        [canonical.id, dup.id]);

      reasignadas += movidas.rowCount ?? 0;

      // Los que sí chocaban ya estaban en el canónico: sobran.
      await db.query('delete from artwork_movements where movement_id = $1', [dup.id]);

      // La memoria de la decisión, para que la ingesta no lo recree.
      await db.query(
        `insert into movement_aliases (alias_qid, alias_slug, movement_id, reason)
         values ($1, $2, $3, $4)
         on conflict do nothing`,
        [dup.wikidata_qid, dup.slug, canonical.id, `duplicado de "${canonical.name}"`]);

      await db.query('delete from movements where id = $1', [dup.id]);
    }
  }

  for (const m of epocas) {
    await db.query('delete from artwork_movements where movement_id = $1', [m.id]);
    await db.query('delete from movements where id = $1', [m.id]);
  }

  await db.query('commit');

  console.log(`\n${reasignadas} enlaces reasignados al movimiento canónico.`);
  console.log(`${plan.reduce((s, p) => s + p.absorbidos.length, 0)} duplicados y ${epocas.length} épocas eliminados.`);
  console.log('Recuerda recalcular contadores: se hace solo en la próxima ingesta.\n');
} catch (err) {
  await db.query('rollback').catch(() => { /* ya abortada */ });
  console.error(`\nError, no se ha cambiado nada: ${(err as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await db.end();
}
