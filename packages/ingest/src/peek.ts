/**
 * Vistazo al catálogo ya ingerido: obras destacadas, movimientos, museos y una
 * prueba de la consulta geográfica "obras cerca de mí".
 *
 *   npm run peek
 *
 * Comprueba de un golpe que la ingesta escribió lo que debía y que las
 * relaciones (artista, museo, movimiento) quedaron bien enlazadas.
 */
import { createDb } from './db.js';
const db = createDb();

const { data: works } = await db.from('artworks')
  .select('id,title,title_es,year_start,date_display,medium,height_cm,width_cm,notability,image_url,artists(name),institutions(name,city,country)')
  .order('notability', { ascending: false }).limit(6);

console.log('\nOBRAS');
for (const w of works ?? []) {
  const a = (w as any).artists?.name ?? '?';
  const i = (w as any).institutions;
  console.log(`  ${w.title}  —  ${a}  (${w.date_display ?? '?'})  [${w.notability} sitelinks]`);
  console.log(`     ${i?.name}, ${i?.city}, ${i?.country} · ${w.medium ?? 'técnica ?'} · ${w.height_cm ?? '?'}×${w.width_cm ?? '?'}cm`);
  console.log(`     ${w.image_url?.slice(0, 88)}`);
}

const { data: movs } = await db.from('movements').select('name,slug,artwork_count').order('artwork_count', { ascending: false });
console.log('\nMOVIMIENTOS:', (movs ?? []).map(m => `${m.name}(${m.artwork_count})`).join(', ') || '—');

const { data: insts } = await db.from('institutions').select('name,city,country_code,artwork_count');
console.log('INSTITUCIONES:', (insts ?? []).map(i => `${i.name} [${i.country_code}] ${i.artwork_count} obras`).join(' | '));

const { data: arts } = await db.from('artists').select('name,birth_year,death_year,artwork_count').order('artwork_count', { ascending: false }).limit(5);
console.log('ARTISTAS:', (arts ?? []).map(a => `${a.name} (${a.birth_year ?? '?'}-${a.death_year ?? '?'}) ${a.artwork_count}`).join(' | '));

// La consulta estrella de la app: obras cerca de un punto de Madrid.
const near = await db.rpc('artworks_near', { lat: 40.4170, lng: -3.6950, radius_m: 2000 });
console.log('\n"OBRAS CERCA DE MÍ" (Paseo del Prado, 2 km):');
for (const w of (near.data ?? []).slice(0, 4)) {
  console.log(`  ${Math.round(w.distance_m)}m  ${w.title} — ${w.artist_name} · ${w.institution_name}`);
}
