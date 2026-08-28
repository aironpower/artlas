-- ============================================================================
-- Artlas · 0013 — "obras cerca de mí" vuelve a usar su índice
--
-- Medido con el catálogo grande: la consulta tardaba 8 segundos y acababa en
-- `canceling statement due to statement timeout`. Es la función estrella de la
-- app y estaba sencillamente caída.
--
-- La causa es la misma que la de 0012. En 0009 el índice geográfico pasó a ser
-- PARCIAL:
--
--     artworks_published_map_idx ... where status = 'published' and image_url is not null
--
-- Un índice parcial solo se puede usar si la consulta demuestra que sus filas
-- caen dentro del filtro. `artworks_near` comprobaba `image_url is not null`
-- pero no decía nada de `status`, así que el planificador lo descartaba y
-- recorría las 113.783 obras calculando distancias, incluidas las 59.000 que
-- esperan datos y nunca se muestran.
--
-- La política RLS ya limitaba el resultado a lo publicado, de modo que la
-- respuesta era correcta; solo que se llegaba a ella por el camino más caro
-- posible. Decirlo explícitamente no cambia lo que devuelve: cambia cómo.
-- ============================================================================

set search_path = public, extensions;

create or replace function artworks_near(
  lat           double precision,
  lng           double precision,
  p_lang        text default 'es',
  radius_m      int  default 5000,
  movement_slug text default null,
  max_results   int  default 100
)
returns table (
  id bigint, title text, slug text, image_url text, year_start int, date_display text,
  artist_name text, institution_name text, institution_slug text,
  distance_m double precision
)
language sql stable set search_path = public, extensions as $fn$
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display,
         coalesce(ta.name, ar.name),
         coalesce(ti.name, i.name),
         i.slug,
         st_distance(a.location, st_makepoint(lng, lat)::geography)
    from artworks a
    left join artists ar     on ar.id = a.artist_id
    left join institutions i on i.id  = a.institution_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
    left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
   -- Las tres condiciones del índice parcial, en el mismo orden en que las
   -- espera: sin ellas no lo usa.
   where a.status = 'published'
     and a.image_url is not null
     and st_dwithin(a.location, st_makepoint(lng, lat)::geography, radius_m)
     and (movement_slug is null or exists (
           select 1 from artwork_movements am
             join movements m on m.id = am.movement_id
            where am.artwork_id = a.id and m.slug = movement_slug))
   order by a.notability desc,
            st_distance(a.location, st_makepoint(lng, lat)::geography) asc
   limit max_results
$fn$;

/**
 * Y lo mismo en el mapa por artista: es barato hoy (339 ms) porque filtra por
 * artista antes que nada, pero deja fuera el índice parcial por el mismo
 * motivo, y con un artista muy prolífico acabaría notándose.
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
     and a.status = 'published'
   order by a.notability desc, a.year_start asc nulls last, a.id
   limit max_results
$fn$;
