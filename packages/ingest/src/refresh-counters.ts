/**
 * Recalcula los contadores del catálogo.
 *
 *   npm run refresh
 *
 * Hace falta si una ingesta se interrumpe: `institutions_in_bbox` filtra por
 * `artwork_count > 0`, así que un museo con obras pero con el contador a cero
 * no sale en el mapa aunque los datos estén.
 */
import { createDb } from './db.js';

const db = createDb();
await db.rpc('refresh_artwork_counters');

const { count: works } = await db.from('artworks').select('*', { count: 'exact', head: true });
const { count: tr } = await db.from('artwork_translations').select('*', { count: 'exact', head: true });
const { count: artists } = await db.from('artists').select('*', { count: 'exact', head: true });
const { data: pins } = await db.rpc('institutions_in_bbox',
  { west: -180, south: -85, east: 180, north: 85, p_lang: 'es' });

console.log(`obras ${works} · traducciones ${tr} · artistas ${artists} · museos en el mapa ${(pins ?? []).length}`);
