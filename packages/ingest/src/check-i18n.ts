/** Comprueba que la migración 0002 se aplicó y que los idiomas están cargados. */
import { createDb } from './db.js';
const db = createDb();
let bad = 0;

const T = ['languages','artwork_translations','artist_translations',
           'institution_translations','movement_translations'];
console.log('\nTablas de i18n');
for (const t of T) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
  if (error) { console.log(`  ✗ ${t.padEnd(26)} ${error.message}`); bad++; }
  else console.log(`  ✓ ${t.padEnd(26)} ${count} filas`);
}

const { data: langs } = await db.from('languages').select('code,name,sort_order').order('sort_order');
console.log('\nIdiomas:', (langs ?? []).map(l => `${l.code}=${l.name}`).join(', ') || '—');

console.log('\nColumnas viejas eliminadas de artworks');
const { error: oldCol } = await db.from('artworks').select('title_es').limit(1);
console.log(oldCol ? '  ✓ title_es ya no existe' : '  ✗ title_es SIGUE existiendo'); if (!oldCol) bad++;

console.log('\nFunciones RPC localizadas');
for (const [fn, args] of [
  ['artworks_near', { lat: 40.41, lng: -3.69, p_lang: 'fr', radius_m: 3000 }],
  ['institutions_in_bbox', { west: -10, south: 35, east: 5, north: 45, p_lang: 'de' }],
  ['search_artworks', { p_query: 'retrato', p_lang: 'es' }],
] as [string, any][]) {
  const { data, error } = await db.rpc(fn, args);
  if (error) { console.log(`  ✗ ${fn.padEnd(22)} ${error.message}`); bad++; }
  else console.log(`  ✓ ${fn.padEnd(22)} devuelve ${data.length} filas`);
}

console.log(bad === 0 ? '\nEsquema multilingüe listo.\n' : `\n${bad} problemas.\n`);
process.exit(bad === 0 ? 0 : 1);
