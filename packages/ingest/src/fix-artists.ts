#!/usr/bin/env node
/**
 * Devuelve su autor a las obras que se quedaron sin él.
 *
 *   npm run fix-artists                 enseña a cuántas se lo devolvería
 *   npm run fix-artists -- --apply      lo escribe
 *   npm run fix-artists -- --pending    incluye también las obras que esperan
 *   npm run fix-artists -- --max 500    solo las N primeras (para probar)
 *
 * Por qué existe: Wikidata movió a `mul` los nombres que se escriben igual en
 * todas las lenguas y borró de muchas entidades sus etiquetas por idioma. Como
 * pedíamos es/en/fr, Picasso volvía sin nombre y el código descartaba al autor.
 * 9.336 obras publicadas —el 15%, Guernica entre ellas— entraron anónimas.
 *
 * El conector ya está arreglado, pero eso solo vale para lo que se ingiera de
 * ahora en adelante. Esto repara lo que ya está dentro sin reingerir nada:
 * reingerir esos museos costaría horas y reescribiría 60.000 filas para
 * arreglar el 15% de una columna.
 *
 * Es reanudable e idempotente por construcción: solo mira obras con
 * `artist_id` nulo, así que volver a lanzarlo continúa donde lo dejó.
 *
 * NO tocar el catálogo con una ingesta viva. Esto escribe en `artists` y en
 * `artworks`, y una ingesta con ids cacheados de por medio ya tumbó un museo.
 */

import { createDb, IdCache } from './db.js';
import { fetchCreators } from './sources/wikidata.js';

const aplicar = process.argv.includes('--apply');
const incluyePendientes = process.argv.includes('--pending');

/**
 * Ojo con el nombre de la bandera: `npm run … -- --limit 50` NO llega aquí.
 * npm reconoce `--limit` como configuración suya y se la queda; al script solo
 * le llega el "50" suelto. Por eso se llama `--max`. Acepta las dos formas,
 * `--max 50` y `--max=50`.
 */
function argNumerico(bandera: string): number | undefined {
  const pegado = process.argv.find((a) => a.startsWith(`${bandera}=`));
  const crudo = pegado
    ? pegado.slice(bandera.length + 1)
    : process.argv[process.argv.indexOf(bandera) + 1];

  if (!process.argv.some((a) => a === bandera || a.startsWith(`${bandera}=`))) return undefined;

  const n = Number(crudo);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const limite = argNumerico('--max');

/** Obras por consulta a Wikidata. El mismo tamaño que usa la hidratación. */
const LOTE = 50;

/** Filas por página al leer de Supabase, que corta en 1.000. */
const PAGINA = 1000;

interface Obra { id: number; wikidata_qid: string; title: string }

const db = createDb();
const cache = new IdCache(db);

/** Lee TODAS las obras sin autor, paginando: Supabase no devuelve más de 1.000. */
async function obrasSinAutor(): Promise<Obra[]> {
  const todas: Obra[] = [];

  for (let desde = 0; ; desde += PAGINA) {
    let q = db
      .from('artworks')
      .select('id, wikidata_qid, title')
      .is('artist_id', null)
      .not('wikidata_qid', 'is', null)
      .order('id')
      .range(desde, desde + PAGINA - 1);

    if (!incluyePendientes) q = q.eq('status', 'published');

    const { data, error } = await q;
    if (error) throw new Error(`leyendo obras sin autor: ${error.message}`);

    todas.push(...(data as Obra[]));
    process.stdout.write(`  leídas ${todas.length}\r`);

    if (data.length < PAGINA) break;
    if (limite && todas.length >= limite) break;
  }

  return limite ? todas.slice(0, limite) : todas;
}

const empezado = Date.now();
const transcurrido = () => {
  const s = Math.round((Date.now() - empezado) / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

console.log(`\nReparando autores${incluyePendientes ? ' (publicadas y pendientes)' : ' (solo publicadas)'}.`);
if (!aplicar) console.log('MODO SECO: no se escribe nada. Añade --apply para ejecutarlo.');

const obras = await obrasSinAutor();
console.log(`\n${obras.length} obras sin autor y con QID de Wikidata.\n`);

if (obras.length === 0) process.exit(0);

let conAutor = 0;        // Wikidata sí les da un nombre utilizable
let sinCreador = 0;      // sin P170, o con P170 de "valor desconocido": anónimas
let sinNombre = 0;       // P170 apunta a una entidad real y aun así no la nombramos
let escritas = 0;
const artistasVistos = new Set<string>();
const muestra: string[] = [];

/*
 * Los lotes que fallan NO tumban la pasada, pero tampoco se los traga el log:
 * se apuntan aquí y salen todos juntos al final, con su motivo. Esa es
 * justamente la queja que provocó esta forma de trabajar — un proceso que
 * reintenta a ciegas y muere sin decir por qué no sirve de nada.
 */
const fallos: { lote: number; obras: number; motivo: string }[] = [];

const total = Math.ceil(obras.length / LOTE);

for (let i = 0; i < obras.length; i += LOTE) {
  const lote = obras.slice(i, i + LOTE);
  const nLote = Math.floor(i / LOTE) + 1;

  try {
    const autores = await fetchCreators(lote.map((o) => o.wikidata_qid));

    // Agrupadas por artista: una escritura por autor, no una por obra.
    const porArtista = new Map<number, number[]>();

    for (const obra of lote) {
      const artista = autores.porObra.get(obra.wikidata_qid);

      if (!artista) {
        if (autores.conCreador.has(obra.wikidata_qid)) sinNombre++; else sinCreador++;
        continue;
      }

      conAutor++;
      artistasVistos.add(artista.wikidataQid ?? artista.name);
      if (muestra.length < 10) muestra.push(`${obra.title} → ${artista.name}`);

      if (!aplicar) continue;

      const artistId = await cache.artistId(artista);
      if (artistId === null) continue;

      porArtista.set(artistId, [...(porArtista.get(artistId) ?? []), obra.id]);
    }

    for (const [artistId, ids] of porArtista) {
      const { error } = await db.from('artworks').update({ artist_id: artistId }).in('id', ids);
      if (error) throw new Error(`escribiendo artist_id ${artistId}: ${error.message}`);
      escritas += ids.length;
    }
  } catch (err) {
    fallos.push({ lote: nLote, obras: lote.length, motivo: (err as Error).message });
  }

  const pct = Math.round((nLote / total) * 100);
  process.stdout.write(
    `  lote ${nLote}/${total} (${pct}%) · ${conAutor} con autor · ${sinCreador} anónimas` +
    `${sinNombre ? ` · ${sinNombre} SIN NOMBRE` : ''}` +
    `${aplicar ? ` · ${escritas} escritas` : ''}` +
    `${fallos.length ? ` · ${fallos.length} lotes fallidos` : ''} · ${transcurrido()}\r`,
  );
}

console.log('\n');

if (muestra.length > 0) {
  console.log('Una muestra de lo encontrado:');
  for (const linea of muestra) console.log(`  ${linea}`);
  console.log('');
}

console.log(`Obras miradas:            ${obras.length}`);
console.log(`Con autor recuperable:    ${conAutor}  (${artistasVistos.size} artistas distintos)`);
console.log(`Anónimas de verdad:       ${sinCreador}  (sin P170, o con autor "desconocido")`);
console.log(`Con autor pero sin nombre: ${sinNombre}${sinNombre ? '  ← esto sí sería un fallo nuestro' : ''}`);
if (aplicar) console.log(`Obras reparadas:          ${escritas}`);
console.log(`Tiempo:                   ${transcurrido()}`);

if (fallos.length > 0) {
  console.log(`\n${fallos.length} lotes fallaron y sus obras siguen sin autor:`);
  for (const f of fallos.slice(0, 20)) {
    console.log(`  lote ${f.lote} (${f.obras} obras): ${f.motivo}`);
  }
  if (fallos.length > 20) console.log(`  … y ${fallos.length - 20} más`);
  console.log('\nVolver a lanzarlo reintenta solo lo que sigue sin autor.');
  process.exitCode = 1;
}

if (!aplicar) {
  console.log('\nModo seco: no se ha escrito nada. Añade --apply.\n');
} else {
  console.log('\nHecho. `npm run refresh` actualiza los contadores por artista.\n');
}
