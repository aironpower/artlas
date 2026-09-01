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
import { capitalize } from './i18n';

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

/**
 * Qué se puede enseñar de una obra. Lo decide `image_mode()` en SQL y la
 * interfaz obedece: si el criterio viviera en el componente, habría uno por
 * cada sitio donde se pinta una imagen.
 *
 *   full       la imagen completa
 *   thumbnail  solo la miniatura del proveedor, con enlace obligado al origen
 *   none       ficha sin imagen
 */
export type ImageMode = 'full' | 'thumbnail' | 'none';

export interface Rights {
  rights_status: 'public_domain' | 'in_copyright' | 'unknown';
  thumbnail_url: string | null;
  origin_url: string | null;
  image_mode: ImageMode;
}

export interface ArtworkCard extends Rights {
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

export interface NearbyArtwork extends Rights {
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

/**
 * Obra de un artista con su punto en el mapa.
 *
 * lat/lng son las coordenadas del museo donde se expone: dos obras del mismo
 * museo traen EXACTAMENTE el mismo par. No es un redondeo ni un fallo de la
 * consulta, es el único dato de posición que existe en el catálogo.
 */
export interface ArtistWork extends Rights {
  id: number;
  title: string;
  slug: string;
  image_url: string | null;
  year_start: number | null;
  date_display: string | null;
  category: string;
  institution_id: number | null;
  institution_name: string | null;
  institution_slug: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  notability: number;
}

export interface Artist {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
  image_url: string | null;
  artwork_count: number;
}

export interface MuseumWork extends Rights {
  id: number;
  title: string;
  slug: string;
  image_url: string | null;
  year_start: number | null;
  date_display: string | null;
  category: string;
  artist_name: string | null;
  artist_slug: string | null;
  notability: number;
}

export interface SearchFilters {
  query?: string;
  movement?: string;
  artist?: string;
  country?: string;
  /** Subfiltro del país: no tiene sentido suelto. */
  city?: string;
  yearFrom?: number;
  yearTo?: number;
  category?: string;
  limit?: number;
  offset?: number;
}

// --- Consultas --------------------------------------------------------------

export async function searchArtworks(
  lang: Lang,
  filters: SearchFilters = {},
): Promise<ArtworkCard[]> {
  /*
   * `|| null` y no `?? null`, y la diferencia importa.
   *
   * Los desplegables de filtro tienen una opción vacía ("—"), así que el
   * formulario envía `mov=` en lugar de omitir el parámetro. Con `??` esa
   * cadena vacía llegaba tal cual al SQL, que buscaba un movimiento cuyo slug
   * fuera "" — no existe ninguno, así que buscar sin elegir filtro devolvía
   * CERO resultados. Con `||`, la cadena vacía se convierte en null, que es lo
   * que significa: "sin filtrar por esto".
   */
  const { data, error } = await db().rpc('search_artworks', {
    p_query: filters.query || null,
    p_lang: lang,
    p_movement: filters.movement || null,
    p_artist: filters.artist || null,
    p_country: filters.country || null,
    p_year_from: filters.yearFrom ?? null,
    p_year_to: filters.yearTo ?? null,
    p_category: filters.category || null,
    p_city: filters.city || null,
    max_results: filters.limit ?? 60,
    p_offset: filters.offset ?? 0,
  });

  if (error) throw new Error(`búsqueda: ${error.message}`);
  return hideRestrictedImage((data ?? []) as ArtworkCard[]);
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
  return hideRestrictedImage((data ?? []) as NearbyArtwork[]);
}

/**
 * Las obras de un museo, paginadas.
 *
 * Antes la ficha de museo pedía "las obras a menos de 50 metros de este punto"
 * con `artworksNear`, para no repetir la cadena de idiomas. Aquello no se podía
 * paginar —`artworks_near` ordena por distancia y no acepta desplazamiento— y
 * además contaba por geografía mientras el contador del museo cuenta por
 * `institution_id`: dos números distintos en la misma pantalla. La migración
 * 0023 estrena una función que pregunta lo que la página quiere decir.
 */
export async function artworksByInstitution(
  lang: Lang,
  slug: string,
  limit = 36,
  offset = 0,
): Promise<MuseumWork[]> {
  const { data, error } = await db().rpc('artworks_by_institution', {
    p_slug: slug,
    p_lang: lang,
    max_results: limit,
    p_offset: offset,
  });

  if (error) throw new Error(`obras de ${slug}: ${error.message}`);
  return hideRestrictedImage((data ?? []) as MuseumWork[]);
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

/**
 * Cuántos artistas tienen obra en el catálogo.
 *
 * `head: true` pide solo la cabecera con el total: no trae ni una fila, que
 * para 1.300 artistas de los que la portada solo enseña el número es la
 * diferencia entre una consulta gratis y traerse la tabla entera.
 */
export async function countArtists(): Promise<number> {
  const { count, error } = await db()
    .from('artists')
    .select('*', { count: 'exact', head: true })
    .gt('artwork_count', 0);

  if (error) throw new Error(`artistas: ${error.message}`);
  return count ?? 0;
}

/** Ficha del artista. Devuelve null si el slug no existe. */
export async function getArtist(lang: Lang, slug: string): Promise<Artist | null> {
  const { data, error } = await db().rpc('get_artist', { p_slug: slug, p_lang: lang });

  if (error) throw new Error(`artista ${slug}: ${error.message}`);
  return ((data ?? []) as Artist[])[0] ?? null;
}

/**
 * Todas las obras de un artista, cada una con su posición.
 *
 * El límite alto es deliberado: el más prolífico del catálogo tiene 175 obras,
 * así que 500 las cubre a todas y evita paginar un mapa, que quedaría
 * incompleto sin avisar.
 */
export async function artworksByArtist(
  lang: Lang,
  slug: string,
  limit = 500,
  offset = 0,
): Promise<ArtistWork[]> {
  const { data, error } = await db().rpc('artworks_by_artist', {
    p_slug: slug,
    p_lang: lang,
    max_results: limit,
    p_offset: offset,
  });

  if (error) throw new Error(`obras de ${slug}: ${error.message}`);
  return hideRestrictedImage((data ?? []) as ArtistWork[]);
}

/**
 * Quita la URL de la imagen cuando la política dice que no se puede enseñar.
 *
 * Sin esto, la obra restringida no pinta la imagen pero SÍ manda su URL al
 * navegador, dentro de los datos serializados de la página: cualquiera que
 * mire el código fuente tiene la ubicación del fichero que hemos decidido no
 * mostrar. Se vio al probar la rama `none` y buscar el dominio en el HTML.
 *
 * Lo suyo sería que tampoco la devolviera SQL. Se hace aquí porque cubre de
 * una vez los dos caminos —las RPC y el select de la ficha— sin volver a
 * recrear tres funciones; conviene bajarlo a SQL cuando se toquen por otra
 * razón.
 */
function hideRestrictedImage<T extends { image_url: string | null; image_mode?: ImageMode }>(
  rows: T[],
): T[] {
  return rows.map((row) =>
    row.image_mode && row.image_mode !== 'full' ? { ...row, image_url: null } : row);
}

/** Servidores cuyo alojamiento ya afirma que el fichero es libre. Misma lista
 * que `image_mode()` en la migración 0018: añadir uno es una decisión de
 * derechos, no técnica. */
const HOSTS_LIBRES = new Set([
  'commons.wikimedia.org', 'upload.wikimedia.org', 'images.metmuseum.org',
]);

export function imageModeFor(
  rights: Rights['rights_status'],
  imageUrl: string | null,
  thumbnailUrl: string | null,
): ImageMode {
  if (imageUrl) {
    try {
      if (HOSTS_LIBRES.has(new URL(imageUrl).host)) return 'full';
    } catch { /* URL rota: decide el resto de la política */ }
  }

  if (rights === 'public_domain' && imageUrl) return 'full';
  if (thumbnailUrl) return 'thumbnail';
  return 'none';
}

/** Ficha completa de una obra, con sus movimientos y su museo. */
export async function getArtwork(lang: Lang, id: number) {
  const { data, error } = await db()
    .from('artworks')
    .select(`
      id, slug, title, year_start, year_end, date_display, category,
      height_cm, width_cm, image_url, iiif_base, image_license,
      source, source_url, notability, rating_avg, rating_count,
      rights_status, thumbnail_url, origin_url,
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
  const mode = imageModeFor(
    row.rights_status as Rights['rights_status'],
    row.image_url as string | null,
    row.thumbnail_url as string | null,
  );

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

    imageUrl: (mode === 'full' ? row.image_url : null) as string | null,
    iiifBase: (mode === 'full' ? row.iiif_base : null) as string | null,
    imageLicense: row.image_license as string | null,
    sourceUrl: row.source_url as string | null,

    rightsStatus: row.rights_status as Rights['rights_status'],
    thumbnailUrl: row.thumbnail_url as string | null,
    originUrl: row.origin_url as string | null,
    /*
     * La ficha se lee con un select y no por RPC, así que aquí no llega
     * `image_mode` calculado. Se replica la MISMA política, y por eso está
     * junto a la que la define en SQL en vez de escondida en un componente.
     * Si cambia una, cambia la otra.
     */
    imageMode: mode,

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
        name: capitalize(pick(m.movement_translations, lang)?.name ?? m.name),
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
    name: capitalize(pick(m.movement_translations, lang)?.name ?? m.name),
    count: m.artwork_count as number,
  }));
}

/**
 * Los artistas con más obra en el catálogo.
 *
 * Doscientos y no los 21.619 que hay. No es una limitación técnica: paginar
 * 21.619 nombres son 217 páginas que nadie recorre, y la cola son artistas con
 * una sola obra cuyo nombre solo sirve si ya lo buscabas —y para eso está el
 * buscador—. Una lista es una puerta de entrada, no un inventario.
 *
 * El nombre sale de `coalesce(traducción, canónico)` como en todas partes: el
 * catálogo dice «Hieronymus Bosch» y en español hay que leer «El Bosco».
 */
export async function listArtists(
  lang: Lang,
  opciones: {
    q?: string;
    sort?: 'name' | 'works' | 'nat' | 'anios';
    dir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    nat?: string;
    desde?: number;
    hasta?: number;
  } = {},
) {
  const {
    q = '', sort = 'works', dir = 'desc', limit = 60, offset = 0,
    nat, desde, hasta,
  } = opciones;

  const { data, error } = await db().rpc('list_artists', {
    p_lang: lang,
    p_q: q || null,
    p_sort: sort,
    p_dir: dir,
    p_limit: limit,
    p_offset: offset,
    p_nat: nat || null,
    p_desde: Number.isFinite(desde) ? desde : null,
    p_hasta: Number.isFinite(hasta) ? hasta : null,
  });

  if (error) throw new Error(`artistas: ${error.message}`);

  const filas = (data ?? []) as {
    slug: string; name: string; nationality: string | null;
    birth_year: number | null; death_year: number | null;
    artwork_count: number; total: number;
  }[];

  return {
    artistas: filas.map((a) => ({
      slug: a.slug,
      name: a.name,
      nationality: a.nationality,
      birthYear: a.birth_year,
      deathYear: a.death_year,
      count: a.artwork_count,
    })),
    // El total viaja repetido en cada fila (`count(*) over ()`); sin filas es 0,
    // que es justo lo que significa una búsqueda sin resultados.
    total: Number(filas[0]?.total ?? 0),
  };
}

/** Las nacionalidades del catálogo, con su recuento, para el desplegable. */
export async function listNationalities() {
  const { data, error } = await db().rpc('list_nationalities');
  if (error) throw new Error(`nacionalidades: ${error.message}`);

  return (data ?? []) as { nationality: string; artists: number }[];
}

/**
 * Todos los movimientos con obra, para su índice.
 *
 * Aparte de `listMovements`, que se queda en 40 porque alimenta un desplegable
 * y una lista de 187 opciones no se recorre con el ratón. Aquí sí se quieren
 * todos: es la página que existe para verlos.
 */
export async function listAllMovements(lang: Lang) {
  const { data, error } = await db()
    .from('movements')
    .select('slug, name, start_year, end_year, artwork_count, movement_translations ( lang, name )')
    .gt('artwork_count', 0)
    .order('artwork_count', { ascending: false });

  if (error) throw new Error(`movimientos: ${error.message}`);

  return (data ?? []).map((m: any) => ({
    slug: m.slug as string,
    name: capitalize(pick(m.movement_translations, lang)?.name ?? m.name),
    startYear: m.start_year as number | null,
    endYear: m.end_year as number | null,
    count: m.artwork_count as number,
  }));
}

/**
 * Ciudades con obras de un país, para el subfiltro.
 *
 * Devuelve el nombre canónico como valor y el traducido como etiqueta. El
 * enlace lleva «New York» aunque la pantalla diga «Nueva York»: si se filtrara
 * por la traducción, el mismo enlace daría resultados distintos en cada idioma.
 */
export async function listCities(lang: Lang, countryCode: string) {
  const { data, error } = await db()
    .from('institutions')
    .select('city, artwork_count, institution_translations ( lang, city )')
    .eq('country_code', countryCode.toUpperCase())
    .gt('artwork_count', 0);

  if (error) throw new Error(`ciudades: ${error.message}`);

  const porCiudad = new Map<string, { value: string; name: string; count: number }>();

  for (const inst of (data ?? []) as any[]) {
    if (!inst.city) continue;
    const nombre = pick(inst.institution_translations, lang)?.city ?? inst.city;
    const ya = porCiudad.get(inst.city);
    if (ya) ya.count += inst.artwork_count;
    else porCiudad.set(inst.city, { value: inst.city, name: nombre, count: inst.artwork_count });
  }

  return [...porCiudad.values()].sort((a, b) => b.count - a.count);
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
