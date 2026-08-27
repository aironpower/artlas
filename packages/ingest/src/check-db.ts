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

const counters = await db.rpc('refresh_artwork_counters');
if (counters.error) { console.log(`  ✗ refresh_artwork_counters ${counters.error.message}`); bad++; }
else console.log('  ✓ refresh_artwork_counters');

console.log(bad === 0 ? '\nBase de datos lista.\n' : `\n${bad} problemas.\n`);
process.exit(bad === 0 ? 0 : 1);
