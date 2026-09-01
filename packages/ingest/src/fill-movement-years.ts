#!/usr/bin/env node
/**
 * Pone época a los movimientos.
 *
 *   npm run fill-movement-years              qué haría, sin tocar nada
 *   npm run fill-movement-years -- --apply   lo escribe
 *
 * Por qué existe: `movements.start_year` y `movements.end_year` llevaban desde
 * `0001_init` en la tabla y a null en las 224 filas, porque la ingesta nunca
 * pidió esas fechas. Los movimientos entran desde la consulta de obras, que
 * solo trae su QID y su nombre. La tabla de `/es/movimientos` enseña la columna
 * vacía.
 *
 * Va aparte de la ingesta, como `fill-images`, y por el mismo motivo: son 210
 * fichas de Wikidata que se resuelven en tres consultas, no algo que tenga
 * sentido arrastrar por cada una de las 269.159 obras. **Después de una ingesta
 * que traiga movimientos nuevos, hay que volver a pasarlo**; es idempotente y
 * cuesta segundos.
 *
 * ## De dónde salen las fechas, y por qué no solo de P580/P582
 *
 * Medido sobre los 210 movimientos con QID antes de escribir esto:
 *
 *     P580 inicio       55
 *     P582 fin          51
 *     P571 concepción   61
 *     P576 disolución   10
 *     con alguna       108
 *
 * Pedir solo P580 y P582 —que era el plan apuntado en NOTAS— habría llenado un
 * cuarto de la tabla. Wikidata reparte estas fechas entre dos pares de
 * propiedades sin mucho criterio: el Impresionismo no declara P580 pero sí
 * P571 = 1860. Con los cuatro se llega a 108 de 210.
 *
 * La mitad de la lista se queda sin fecha, y hay que decirlo: son movimientos
 * de cola. Donde se mira, la cobertura es otra:
 *
 *     los 20 con más obras   15/20   75%
 *     todos                 108/210  51%   pero cubren el 74% de las obras
 *
 * ## Cuando Wikidata da varias fechas
 *
 * Se coge **la más temprana para el inicio y la más tardía para el fin**, que
 * es lo que significa la época de un movimiento. Y sobre todo: es una regla
 * fija. Quedarse con «la que venga primero» es lo que hace que 5 de cada 300
 * obras cambien solas en cada refresco —SPARQL no garantiza el orden—, y ese
 * error no se repite aquí.
 */

import pg from 'pg';

const aplicar = process.argv.includes('--apply');
const UA = process.env.WIKIDATA_USER_AGENT ?? 'Artlas/0.1 (contacto@artlas.app)';
const ENDPOINT = 'https://query.wikidata.org/sparql';

/*
 * Cuántos QID caben en una consulta. La consulta viaja en la URL, así que un
 * `values` con los 210 la deja larguísima; ya hubo lotes muertos por eso en la
 * verificación de imágenes. 75 es holgado y son tres viajes.
 */
const POR_CONSULTA = 75;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\nFalta DATABASE_URL en el .env de la raíz.\n');
  process.exit(1);
}

interface Epoca { inicio: number | null; fin: number | null }

/**
 * El año de una fecha de Wikidata.
 *
 * Llegan como `1420-01-01T00:00:00Z`, y las anteriores a Cristo con un signo
 * delante: `-0500-01-01T00:00:00Z`. Cortar por el primer guion se comería ese
 * signo y convertiría el 500 a.C. en el 500 d.C., mil años de diferencia en
 * silencio.
 */
function anio(valor: string | undefined): number | null {
  if (!valor) return null;
  const m = /^(-?)(\d{1,6})-/.exec(valor);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n) || n === 0) return null;
  return m[1] === '-' ? -n : n;
}

async function pedirEpocas(qids: string[]): Promise<Map<string, Epoca>> {
  const epocas = new Map<string, Epoca>();

  for (let i = 0; i < qids.length; i += POR_CONSULTA) {
    const trozo = qids.slice(i, i + POR_CONSULTA);
    const valores = trozo.map((q) => `wd:${q}`).join(' ');

    /*
     * Sin `optional` un movimiento al que le falte cualquiera de las cuatro
     * desaparecería del resultado entero, que es justo el caso mayoritario.
     */
    const sparql = `
      select ?m ?inicio ?fin ?concepcion ?disuelto where {
        values ?m { ${valores} }
        optional { ?m wdt:P580 ?inicio }
        optional { ?m wdt:P582 ?fin }
        optional { ?m wdt:P571 ?concepcion }
        optional { ?m wdt:P576 ?disuelto }
      }`;

    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(sparql)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    });

    if (!res.ok) throw new Error(`Wikidata respondió ${res.status} al pedir las épocas`);

    const json = await res.json() as {
      results: { bindings: Record<string, { value: string }>[] };
    };

    /*
     * Una ficha con dos P580 devuelve dos filas, así que se van fusionando:
     * la más temprana manda para el inicio y la más tardía para el fin.
     */
    for (const fila of json.results.bindings) {
      const qid = fila.m!.value.split('/').pop()!;
      const previo = epocas.get(qid) ?? { inicio: null, fin: null };

      for (const campo of ['inicio', 'concepcion'] as const) {
        const a = anio(fila[campo]?.value);
        if (a !== null && (previo.inicio === null || a < previo.inicio)) previo.inicio = a;
      }
      for (const campo of ['fin', 'disuelto'] as const) {
        const a = anio(fila[campo]?.value);
        if (a !== null && (previo.fin === null || a > previo.fin)) previo.fin = a;
      }

      epocas.set(qid, previo);
    }
  }

  return epocas;
}

// ---------------------------------------------------------------------------

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const { rows: movimientos } = await db.query<{
  id: string; wikidata_qid: string; name: string;
  start_year: number | null; end_year: number | null; artwork_count: number;
}>(`select id, wikidata_qid, name, start_year, end_year, artwork_count
      from movements where wikidata_qid is not null
     order by artwork_count desc, name`);

const { rows: filasSinQid } = await db.query<{ n: string }>(
  'select count(*) n from movements where wikidata_qid is null',
);
const sinQid = Number(filasSinQid[0]?.n ?? 0);

console.log(`\n${movimientos.length} movimientos con QID en Wikidata.`);
if (sinQid > 0) {
  // No es un fallo que arreglar aquí: sin QID no hay ficha a la que preguntar.
  console.log(`${sinQid} sin QID, que no pueden tener fecha por este camino.`);
}

const epocas = await pedirEpocas(movimientos.map((m) => m.wikidata_qid));

interface Cambio { id: string; name: string; obras: number; inicio: number | null; fin: number | null; antes: string }

const cambios: Cambio[] = [];
let yaEstaban = 0;
let sinFecha = 0;

for (const m of movimientos) {
  const e = epocas.get(m.wikidata_qid) ?? { inicio: null, fin: null };

  if (e.inicio === null && e.fin === null) { sinFecha++; continue; }

  // Solo lo que de verdad cambia: escribir lo que ya es verdad es lo que
  // engorda esta base, y aquí no hace falta ni para 210 filas.
  if (e.inicio === m.start_year && e.fin === m.end_year) { yaEstaban++; continue; }

  cambios.push({
    id: m.id,
    name: m.name,
    obras: m.artwork_count,
    inicio: e.inicio,
    fin: e.fin,
    antes: m.start_year === null && m.end_year === null
      ? '—'
      : `${m.start_year ?? '?'}–${m.end_year ?? '?'}`,
  });
}

console.log(`\n  ${cambios.length} con fecha nueva`);
console.log(`  ${yaEstaban} ya la tenían igual`);
console.log(`  ${sinFecha} sin fecha en Wikidata (ni P580/P582 ni P571/P576)\n`);

for (const c of cambios.slice(0, 25)) {
  const epoca = `${c.inicio ?? '?'}–${c.fin ?? '?'}`;
  console.log(
    `  ${c.name.slice(0, 34).padEnd(34)} ${String(c.obras).padStart(5)} obras   ` +
    `${c.antes.padStart(9)} → ${epoca}`,
  );
}
if (cambios.length > 25) console.log(`  … y ${cambios.length - 25} más`);

if (!aplicar) {
  console.log('\nMODO SECO: no se ha escrito nada. Añade --apply para hacerlo.\n');
  await db.end();
  process.exit(0);
}

for (const c of cambios) {
  await db.query(
    'update movements set start_year = $2, end_year = $3 where id = $1',
    [c.id, c.inicio, c.fin],
  );
}

console.log(`\n${cambios.length} movimientos con época. Hecho.\n`);
await db.end();
