/**
 * Acceso a datos del catálogo.
 *
 * Todo pasa por la anon key y las políticas RLS del esquema: el catálogo es
 * público de lectura y nada más. La service_role key nunca entra aquí.
 *
 * Las consultas con idioma van siempre por las funciones RPC del esquema
 * (`artworks_near`, `search_artworks`, `institutions_in_bbox`) y no por
 * consultas armadas aquí. La cadena de respaldo —idioma pedido, luego inglés,
 * luego lo que haya— vive en SQL para que no se reimplemente en cada pantalla
 * y se acabe comportando distinto en cada una.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Lang } from './i18n';

/**
 * Cliente perezoso.
 *
 * Se crea en la primera consulta y no al importar el módulo: si faltara la
 * configuración, importar reventaría la COMPILACIÓN entera con un error que no
 * dice en qué página estabas. Así falla la petición concreta, con un mensaje
 * que se entiende, y `next build` sigue funcionando en un entorno sin secretos.
 */
let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Cópialas de Supabase (Project Settings > API) al fichero .env de la raíz.',
    );
  }

  client = createClient(url, anonKey, { auth: { persistSession: false } });
  return client;
}

/** Para consultas sueltas fuera de las funciones de este módulo. */
export const supabase = new Proxy({} as SupabaseClient, {
  get: (_target, prop) => Reflect.get(db(), prop),
});

// --- Tipos que devuelven las RPC -------------------------------------------

export interface ArtworkCard {
  id: number;
  title: string;
  slug: string;
  image_url: string | null;
  year_start: number | null;
  date_display: string | null;
  category: string;
  artist_name: string | null;
  artist_slug: string | null;
  institution_name: string | null;
  institution_slug: string | null;
  city: string | null;
  country: string | null;
  notability: number;
  rank: number;
}

export interface NearbyArtwork {
  id: number;
  title: string;
  slug: string;
  image_url: string | null;
  year_start: number | null;
  date_display: string | null;
  artist_name: string | null;
  institution_name: string | null;
  institution_slug: string | null;
  distance_m: number;
}

export interface MapPin {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  artwork_count: number;
  rating_avg: number | null;
}

export interface SearchFilters {
  query?: string;
  movement?: string;
  artist?: string;
  country?: string;
  yearFrom?: number;
  yearTo?: number;
  category?: string;
  limit?: number;
}

// --- Consultas --------------------------------------------------------------

export async function searchArtworks(
  lang: Lang,
  filters: SearchFilters = {},
): Promise<ArtworkCard[]> {
  const { data, error } = await db().rpc('search_artworks', {
    p_query: filters.query ?? null,
    p_lang: lang,
    p_movement: filters.movement ?? null,
    p_artist: filters.artist ?? null,
    p_country: filters.country ?? null,
    p_year_from: filters.yearFrom ?? null,
    p_year_to: filters.yearTo ?? null,
    p_category: filters.category ?? null,
    max_results: filters.limit ?? 60,
  });

  if (error) throw new Error(`búsqueda: ${error.message}`);
  return (data ?? []) as ArtworkCard[];
}

export async function artworksNear(
  lang: Lang,
  lat: number,
  lng: number,
  radiusM = 5000,
  movement?: string,
): Promise<NearbyArtwork[]> {
  const { data, error } = await db().rpc('artworks_near', {
    lat,
    lng,
    p_lang: lang,
    radius_m: radiusM,
    movement_slug: movement ?? null,
    max_results: 60,
  });

  if (error) throw new Error(`cercanas: ${error.message}`);
  return (data ?? []) as NearbyArtwork[];
}

export async function mapPins(lang: Lang): Promise<MapPin[]> {
  // Mundo entero: los museos son pocos (decenas), así que no hace falta
  // pedirlos por tesela. Cuando el catálogo crezca a miles de instituciones,
  // esto pasará a consultarse por el bbox visible del mapa.
  const { data, error } = await db().rpc('institutions_in_bbox', {
    west: -180, south: -85, east: 180, north: 85,
    p_lang: lang,
  });

  if (error) throw new Error(`mapa: ${error.message}`);
  return (data ?? []) as MapPin[];
}

/** Ficha completa de una obra, con sus movimientos y su museo. */
export async function getArtwork(lang: Lang, id: number) {
  const { data, error } = await db()
    .from('artworks')
    .select(`
      id, slug, title, year_start, year_end, date_display, category,
      height_cm, width_cm, image_url, iiif_base, image_license,
      source, source_url, notability, rating_avg, rating_count,
      artists ( id, slug, name, birth_year, death_year, nationality,
                artist_translations ( lang, name, description ) ),
      institutions ( id, slug, name, city, country, country_code, website,
                     institution_translations ( lang, name, city, country ) ),
      artwork_translations ( lang, title, description, medium, genre ),
      artwork_movements ( movements ( id, slug, name,
                          movement_translations ( lang, name ) ) )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`obra ${id}: ${error.message}`);
  if (!data) return null;

  return localizeArtwork(data, lang);
}

/**
 * Aplica la cadena de respaldo a una ficha: idioma pedido -> inglés -> lo que
 * haya -> valor neutro de la tabla.
 *
 * Aquí sí se resuelve en TypeScript y no en SQL, porque la ficha trae las
 * traducciones anidadas de cinco entidades a la vez y hacerlo con joins
 * laterales para cada una convertiría la consulta en algo ilegible.
 */
interface TranslationRow { lang: string; [field: string]: string | null }

function pick(
  rows: TranslationRow[] | null | undefined,
  lang: Lang,
): TranslationRow | undefined {
  const list = rows ?? [];
  return list.find((r) => r.lang === lang)
      ?? list.find((r) => r.lang === 'en')
      ?? list[0];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function localizeArtwork(row: any, lang: Lang) {
  const text = pick(row.artwork_translations, lang);
  const artistText = pick(row.artists?.artist_translations, lang);
  const instText = pick(row.institutions?.institution_translations, lang);

  return {
    id: row.id as number,
    slug: row.slug as string,
    title: text?.title ?? row.title,
    description: text?.description ?? null,
    medium: text?.medium ?? null,
    genre: text?.genre ?? null,

    yearStart: row.year_start as number | null,
    dateDisplay: row.date_display as string | null,
    category: row.category as string,
    heightCm: row.height_cm as number | null,
    widthCm: row.width_cm as number | null,

    imageUrl: row.image_url as string | null,
    iiifBase: row.iiif_base as string | null,
    imageLicense: row.image_license as string | null,
    sourceUrl: row.source_url as string | null,

    ratingAvg: row.rating_avg as number | null,
    ratingCount: row.rating_count as number,

    artist: row.artists
      ? {
          id: row.artists.id as number,
          slug: row.artists.slug as string,
          name: artistText?.name ?? row.artists.name,
          description: artistText?.description ?? null,
          birthYear: row.artists.birth_year as number | null,
          deathYear: row.artists.death_year as number | null,
        }
      : null,

    institution: row.institutions
      ? {
          id: row.institutions.id as number,
          slug: row.institutions.slug as string,
          name: instText?.name ?? row.institutions.name,
          city: instText?.city ?? row.institutions.city,
          country: instText?.country ?? row.institutions.country,
          website: row.institutions.website as string | null,
        }
      : null,

    movements: (row.artwork_movements ?? [])
      .map((link: any) => link.movements)
      .filter(Boolean)
      .map((m: any) => ({
        id: m.id as number,
        slug: m.slug as string,
        name: pick(m.movement_translations, lang)?.name ?? m.name,
      })),
  };
}

export type LocalizedArtwork = NonNullable<Awaited<ReturnType<typeof getArtwork>>>;

/** Movimientos con obras, para los filtros. */
export async function listMovements(lang: Lang) {
  const { data, error } = await db()
    .from('movements')
    .select('id, slug, name, artwork_count, movement_translations ( lang, name )')
    .gt('artwork_count', 0)
    .order('artwork_count', { ascending: false })
    .limit(40);

  if (error) throw new Error(`movimientos: ${error.message}`);

  return (data ?? []).map((m: any) => ({
    slug: m.slug as string,
    name: pick(m.movement_translations, lang)?.name ?? m.name,
    count: m.artwork_count as number,
  }));
}

/** Países con obras, para los filtros. */
export async function listCountries(lang: Lang) {
  const { data, error } = await db()
    .from('institutions')
    .select('country_code, country, artwork_count, institution_translations ( lang, country )')
    .gt('artwork_count', 0);

  if (error) throw new Error(`países: ${error.message}`);

  const byCode = new Map<string, { code: string; name: string; count: number }>();

  for (const inst of (data ?? []) as any[]) {
    if (!inst.country_code) continue;

    const name = pick(inst.institution_translations, lang)?.country ?? inst.country;
    const existing = byCode.get(inst.country_code);

    if (existing) existing.count += inst.artwork_count;
    else byCode.set(inst.country_code, {
      code: inst.country_code, name: name ?? inst.country_code, count: inst.artwork_count,
    });
  }

  return [...byCode.values()].sort((a, b) => b.count - a.count);
}
