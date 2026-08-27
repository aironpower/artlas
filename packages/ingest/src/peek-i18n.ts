/** Muestra el catálogo en varios idiomas usando las RPC localizadas. */
import { createDb } from './db.js';
const db = createDb();

const { count: tr } = await db.from('artwork_translations').select('*', { count: 'exact', head: true });
console.log('filas de traducción de obras:', tr);

const { data: sample } = await db.from('artwork_translations')
  .select('lang,title,medium,genre,artworks(year_start)').limit(100);
const byWork = new Map<string, any[]>();
for (const r of sample ?? []) {
  const k = String((r as any).artworks?.year_start);
  byWork.set(k, [...(byWork.get(k) ?? []), r]);
}

console.log('\nLa misma obra en los 7 idiomas:');
const first = [...byWork.values()][0] ?? [];
for (const r of first) console.log(`   ${r.lang}: ${r.title}  ·  ${r.medium ?? '—'}  ·  ${r.genre ?? '—'}`);

console.log('\n"Obras cerca del Paseo del Prado" en cada idioma:');
for (const lang of ['es', 'en', 'fr', 'de', 'nl']) {
  const { data } = await db.rpc('artworks_near',
    { lat: 40.4160, lng: -3.6947, p_lang: lang, radius_m: 1500, max_results: 2 });
  const line = (data ?? []).map((w: any) => `${w.title} (${w.artist_name})`).join(' · ');
  console.log(`   [${lang}] ${line || '—'}`);
  if (lang === 'fr') {
    const m = (data ?? [])[0];
    if (m) console.log(`        museo en francés: ${m.institution_name}`);
  }
}

console.log('\nBúsqueda full-text con el diccionario de cada idioma:');
for (const [q, lang] of [['retratos', 'es'], ['portraits', 'en'], ['gemälde', 'de']] as [string,string][]) {
  const { data, error } = await db.rpc('search_artworks', { p_query: q, p_lang: lang, max_results: 3 });
  console.log(`   "${q}" [${lang}] -> ${error ? 'ERROR ' + error.message : (data ?? []).length + ' resultados'}`);
  for (const w of (data ?? []).slice(0,2)) console.log(`        ${w.title} — ${w.artist_name}`);
}
