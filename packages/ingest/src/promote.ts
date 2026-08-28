#!/usr/bin/env node
/**
 * Publica las obras que ya cumplen, y despublica las que dejaron de cumplir.
 *
 *   npm run promote              enseña qué haría, sin tocar nada
 *   npm run promote -- --apply   lo hace
 *
 * La ingesta clasifica lo que entra; esto reclasifica lo que YA está dentro.
 * Hace falta porque el estado de una obra cambia sin que nadie la vuelva a
 * ingerir: le llega una imagen desde la API de su museo, o su autor cumple 70
 * años de fallecido y la obra entra en dominio público un 1 de enero.
 *
 * Usa `auditArtwork`, la misma función con la que el auditor detecta problemas
 * y con la que la puerta de entrada clasifica lo que llega. Tres momentos
 * distintos, un solo criterio.
 *
 * Respeta `status_locked`: si una persona decidió el estado de una obra a mano,
 * esto no se lo pisa.
 */

import pg from 'pg';
import { auditArtwork } from './audit/rules.js';
import type { ArtworkRow } from './audit/types.js';

/* Las mismas reglas que en `audit/gate.ts`. Si una obra ya no las incumple,
 * es que le ha llegado lo que le faltaba. */
const WAITS_FOR_DATA = new Set(['image_missing', 'institution_missing']);
const PROVES_NOT_ARTWORK = new Set(['image_is_vector', 'title_is_url']);

const aplicar = process.argv.includes('--apply');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\nFalta DATABASE_URL en el .env de la raíz.\n');
  process.exit(1);
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

try {
  /*
   * Se miran las pendientes Y las publicadas: esto no solo asciende, también
   * degrada. Si una obra publicada pierde la imagen —porque el museo retiró el
   * fichero y el auditor lo marcó—, tiene que volver a la sala de espera en
   * vez de quedarse en la app enseñando un hueco.
   */
  const { rows } = await db.query<ArtworkRow & { status: string; pending_reason: string | null }>(`
    select id, title, image_url, artist_id, institution_id,
           year_start, year_end, date_display, notability,
           status, pending_reason
      from artworks
     where status in ('pending', 'published')
       and status_locked = false`);

  console.log(`\n${rows.length} obras revisables (las bloqueadas a mano se saltan).`);
  if (!aplicar) console.log('MODO SECO: no se escribe nada. Añade --apply para ejecutarlo.');

  const aPublicar: number[] = [];
  const aEsperar: { id: number; motivo: string }[] = [];

  for (const row of rows) {
    const findings = auditArtwork(row);
    const fatal = findings.find((f) => PROVES_NOT_ARTWORK.has(f.rule));
    const falta = findings.find((f) => WAITS_FOR_DATA.has(f.rule));

    if (row.status === 'pending' && !fatal && !falta) {
      aPublicar.push(row.id);
    } else if (row.status === 'published' && (fatal || falta)) {
      aEsperar.push({ id: row.id, motivo: fatal?.rule ?? falta!.rule });
    }
  }

  console.log(`\n  ${aPublicar.length} obras pasan a publicadas`);
  console.log(`  ${aEsperar.length} obras publicadas que ya no cumplen y vuelven a esperar`);

  if (aEsperar.length > 0) {
    const porMotivo = new Map<string, number>();
    for (const x of aEsperar) porMotivo.set(x.motivo, (porMotivo.get(x.motivo) ?? 0) + 1);
    for (const [m, n] of porMotivo) console.log(`      ${n} por ${m}`);
  }

  if (!aplicar) {
    console.log();
    process.exit(0);
  }

  await db.query('begin');

  for (let i = 0; i < aPublicar.length; i += 1000) {
    await db.query(
      `update artworks set status = 'published', pending_reason = null where id = any($1::bigint[])`,
      [aPublicar.slice(i, i + 1000)]);
  }

  for (const { id, motivo } of aEsperar) {
    await db.query(
      `update artworks set status = 'pending', pending_reason = $2 where id = $1`, [id, motivo]);
  }

  await db.query('commit');

  console.log('\nHecho. Recalculando contadores…');
  await db.query('select refresh_artwork_counters()');
  console.log('Listo.\n');
} catch (err) {
  await db.query('rollback').catch(() => { /* ya abortada */ });
  console.error(`\nError, no se ha cambiado nada: ${(err as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await db.end();
}
