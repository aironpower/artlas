/**
 * Comprueba que la migración se aplicó y que las credenciales conectan.
 *
 *   npm run check-db
 */
import { createDb } from './db.js';

const db = createDb();
let bad = 0;

const TABLES = [
  'institutions', 'artists', 'movements', 'artworks',
  'artwork_movements', 'artwork_ratings', 'institution_ratings', 'favorites',
];

console.log('\nTablas');
for (const t of TABLES) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
  if (error) { console.log(`  ✗ ${t.padEnd(20)} ${error.message}`); bad++; }
  else console.log(`  ✓ ${t.padEnd(20)} ${count} filas`);
}

console.log('\nFunciones RPC (las que usará la app constantemente)');

// Obras cerca del Prado. Con la base vacía debe devolver [] sin error:
// lo que se comprueba aquí es que PostGIS y el search_path funcionan.
const near = await db.rpc('artworks_near', { lat: 40.4138, lng: -3.6922, radius_m: 3000 });
if (near.error) { console.log(`  ✗ artworks_near        ${near.error.message}`); bad++; }
else console.log(`  ✓ artworks_near        devuelve ${near.data.length} obras`);

const bbox = await db.rpc('institutions_in_bbox', { west: -10, south: 35, east: 5, north: 45 });
if (bbox.error) { console.log(`  ✗ institutions_in_bbox ${bbox.error.message}`); bad++; }
else console.log(`  ✓ institutions_in_bbox devuelve ${bbox.data.length} museos`);

// Mapa por artista (migracion 0004). Goya es el mas prolifico del catalogo,
// pero el slug puede no estar si la ingesta no ha llegado: lo que se comprueba
// es que la funcion EXISTE y responde, no cuantas filas trae.
const byArtist = await db.rpc('artworks_by_artist', { p_slug: 'francisco-goya' });
if (byArtist.error) { console.log(`  ✗ artworks_by_artist   ${byArtist.error.message}`); bad++; }
else {
  const located = byArtist.data.filter((w: { lat: number | null }) => w.lat !== null).length;
  const points = new Set(byArtist.data.map((w: { lat: number; lng: number }) => `${w.lat},${w.lng}`)).size;
  console.log(`  ✓ artworks_by_artist   ${byArtist.data.length} obras, ${located} localizadas, ${points} puntos distintos`);
}

const artist = await db.rpc('get_artist', { p_slug: 'francisco-goya' });
if (artist.error) { console.log(`  ✗ get_artist           ${artist.error.message}`); bad++; }
else console.log(`  ✓ get_artist           ${artist.data[0]?.name ?? 'sin filas'}`);

const counters = await db.rpc('refresh_artwork_counters');
if (counters.error) { console.log(`  ✗ refresh_artwork_counters ${counters.error.message}`); bad++; }
else console.log('  ✓ refresh_artwork_counters');

/*
 * Tamano ocupado. Va aqui y no en una herramienta aparte porque la pregunta
 * "?cabemos todavia?" hay que hacersela cada vez que se mira la base, no el
 * dia que Supabase corta las escrituras. El plan gratuito son 500 MB.
 */
const size = await db.rpc('catalog_size');
if (size.error) {
  console.log(`\nTamano: no disponible (${size.error.message})`);
} else {
  console.log('\nEspacio ocupado');
  let bytes = 0;
  for (const t of size.data as
       { tipo: string; objeto: string; filas_aprox: number; tamano: string; bytes: number }[]) {
    bytes += t.bytes;
    if (t.bytes > 200_000) {
      console.log(`  ${(t.tipo ?? '').padEnd(7)} ${t.objeto.padEnd(34)} ${t.tamano.padStart(9)}`);
    }
  }
  const mb = bytes / 1_048_576;
  console.log(`  ${'TOTAL'.padEnd(26)} ${mb.toFixed(1).padStart(6)} MB   ` +
    `(${(100 * mb / 500).toFixed(1)}% de los 500 MB del plan gratuito)`);
}

console.log(bad === 0 ? '\nBase de datos lista.\n' : `\n${bad} problemas.\n`);
process.exit(bad === 0 ? 0 : 1);
