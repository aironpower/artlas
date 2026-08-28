-- ============================================================================
-- Artlas · 0004 — mapa de las obras de un artista
--
-- `search_artworks` ya filtra por artista, pero no devuelve la posición de
-- cada obra, así que no sirve para pintar un mapa. Esta migración añade la
-- consulta que sí la devuelve.
--
-- Sobre las coordenadas: `artworks.location` es la copia del punto del museo
-- (ver el comentario de la columna en 0001). Por tanto dos obras del mismo
-- museo devuelven EXACTAMENTE el mismo lat/lng. Es el dato real que tenemos
-- —no hay coordenadas de sala en ninguna de nuestras fuentes— y quien pinte
-- el mapa tiene que contar con que varios puntos coincidan.
-- ============================================================================

set search_path = public, extensions;

/**
 * Todas las obras de un artista, localizadas y con su punto en el mapa.
 *
 * Mismo patrón de idioma que el resto: LEFT JOIN a la traducción pedida, a la
 * inglesa y respaldo a la columna neutra, para que una obra sin traducir no
 * desaparezca del listado.
 *
 * lat/lng pueden venir NULL si la obra no tiene museo asignado. Se devuelven
 * igual: la obra existe y debe salir en la rejilla aunque no pueda ser un
 * punto del mapa.
 */
create or replace function artworks_by_artist(
  p_slug      text,
  p_lang      text default 'es',
  max_results int  default 500
)
returns table (
  id bigint, title text, slug text, image_url text,
  year_start int, date_display text, category text,
  institution_id bigint, institution_name text, institution_slug text,
  city text, country text,
  lat double precision, lng double precision,
  notability int
)
language sql stable set search_path = public, extensions as $fn$
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display, a.category,
         i.id,
         coalesce(ti.name, i.name),
         i.slug,
         coalesce(ti.city, i.city),
         coalesce(ti.country, i.country),
         st_y(a.location::geometry),
         st_x(a.location::geometry),
         a.notability
    from artworks a
    join artists ar on ar.id = a.artist_id
    left join institutions i on i.id = a.institution_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join institution_translations ti
      on ti.institution_id = i.id and ti.lang = p_lang
   where ar.slug = p_slug
   order by a.notability desc, a.year_start asc nulls last, a.id
   limit max_results
$fn$;

comment on function artworks_by_artist(text, text, int) is
  'Obras de un artista con lat/lng para el mapa por artista. Las obras de un mismo museo comparten punto: es el dato real, no un defecto.';

/**
 * Ficha del artista en el idioma pedido.
 *
 * Podría resolverse con un select normal desde la app, pero entonces la cadena
 * de respaldo de idioma quedaría escrita en TypeScript para esta pantalla y en
 * SQL para todas las demás, que es justo lo que 0002 vino a evitar.
 */
create or replace function get_artist(p_slug text, p_lang text default 'es')
returns table (
  id bigint, slug text, name text, description text,
  birth_year int, death_year int, nationality text,
  image_url text, artwork_count int
)
language sql stable set search_path = public, extensions as $fn$
  select ar.id, ar.slug,
         coalesce(ta.name, ta_en.name, ar.name),
         coalesce(ta.description, ta_en.description),
         ar.birth_year, ar.death_year, ar.nationality,
         ar.image_url, ar.artwork_count
    from artists ar
    left join artist_translations ta    on ta.artist_id = ar.id and ta.lang = p_lang
    left join artist_translations ta_en on ta_en.artist_id = ar.id and ta_en.lang = 'en'
   where ar.slug = p_slug
   order by ar.artwork_count desc
   limit 1
$fn$;
