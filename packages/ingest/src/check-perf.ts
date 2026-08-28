/**
 * Cuánto tarda cada consulta que hace la app.
 *
 *   npm run check-perf
 *
 * Existe porque el catálogo pasó de 6.000 a 113.000 obras en una noche y dos
 * funciones se rompieron sin que la web lo dijera: `search_artworks` agotaba el
 * tiempo al prerenderizar la portada, y `artworks_near` —el botón "cerca de
 * mí"— tardaba 8 segundos y moría. Las dos por lo mismo: los índices de 0009
 * son parciales sobre `published` y las consultas no mencionaban la condición,
 * así que el planificador los descartaba.
 *
 * Un fallo así no aparece en un typecheck ni en un build: aparece cuando un
 * usuario pulsa un botón. Ejecutar esto tras cada ingesta grande lo adelanta.
 */
import { createClient } from '@supabase/supabase-js';

/*
 * Con la ANON key, no con la service_role, y esto no es un detalle.
 *
 * La primera versión medía con service_role y daba todo por bueno: "cerca de
 * mí" en 642 ms, buscar "goya" en 1.886 ms. Pero la web usa la anon key, cuyo
 * rol tiene `statement_timeout = 3s` en Supabase, y por ahí las dos consultas
 * morían con un 500. Medir por un camino distinto al del usuario es no medir.
 */
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

const LIMITE_MS = 3000;
let fallos = 0;

async function mide(etiqueta: string, fn: () => PromiseLike<any>) {
  const t = Date.now();
  const { data, error } = await fn();
  const ms = Date.now() - t;
  const marca = error ? '✗' : ms > LIMITE_MS * 0.6 ? '!' : '✓';
  console.log(`  ${marca} ${String(ms).padStart(6)} ms  ${etiqueta.padEnd(40)} ` +
    `${error ? 'ERROR ' + error.message.slice(0, 46) : `${data?.length ?? 0} filas`}`);
  if (error) fallos++;
}

console.log(`\nConsultas de la app, por el mismo camino que el navegador.`);
console.log(`El rol anon corta a los ${LIMITE_MS} ms; ! avisa a partir del 60%.\n`);

await mide('portada: 12 destacadas (sin texto)', () =>
  db.rpc('search_artworks', { p_query: null, p_lang: 'es', max_results: 12 }));

await mide('buscar "goya"', () =>
  db.rpc('search_artworks', { p_query: 'goya', p_lang: 'es', max_results: 60 }));

await mide('buscar "meninas"', () =>
  db.rpc('search_artworks', { p_query: 'meninas', p_lang: 'es', max_results: 60 }));

await mide('filtrar por movimiento (sin texto)', () =>
  db.rpc('search_artworks', { p_query: null, p_lang: 'es', p_movement: 'impressionism', max_results: 60 }));

await mide('filtrar por país (sin texto)', () =>
  db.rpc('search_artworks', { p_query: null, p_lang: 'es', p_country: 'es', max_results: 60 }));

await mide('mapa: museos en el mundo', () =>
  db.rpc('institutions_in_bbox', { west: -180, south: -85, east: 180, north: 85, p_lang: 'es' }));

await mide('cerca de mí (Prado, 2 km)', () =>
  db.rpc('artworks_near', { lat: 40.4138, lng: -3.6922, p_lang: 'es', radius_m: 2000, max_results: 60 }));

await mide('obras de Goya con mapa', () =>
  db.rpc('artworks_by_artist', { p_slug: 'francisco-goya', p_lang: 'es', max_results: 500 }));

await mide('ficha de artista', () =>
  db.rpc('get_artist', { p_slug: 'francisco-goya', p_lang: 'es' }));

console.log(fallos === 0
  ? '\nTodas responden dentro del límite.\n'
  : `\n${fallos} consultas fallan: la web devuelve 500 en esas páginas.\n`);

process.exit(fallos === 0 ? 0 : 1);
