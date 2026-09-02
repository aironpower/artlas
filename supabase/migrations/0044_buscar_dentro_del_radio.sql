-- ============================================================================
-- Artlas · 0044 — buscar DENTRO del radio
--
-- La lista de obras alrededor de un punto trae como mucho 60, y el mapa deja
-- pedir hasta 200 km. Medido contra el catálogo real:
--
--     Barcelona   5 km   ≥ 1.000 obras
--     Madrid      1 km       587
--     París       5 km   ≥ 1.000
--
-- Es decir: la caja para buscar entre esas obras, si filtra en el navegador,
-- filtra entre 60 de más de mil. Escribir «picasso» y ver «ninguna coincide»
-- sería mentir con la misma cara con la que antes mentía un círculo pintado
-- más grande que el radio preguntado. El filtro tiene que preguntarse aquí.
--
-- ## Va en el paso 1, con el de movimiento y por su mismo motivo
--
-- `0040` partió esta función en dos —primero quiénes, luego cómo se llaman—
-- y dejó dicho por qué el filtro de movimiento va DENTRO del primer paso: si
-- se aplicara después del `limit 60`, «impresionismo cerca de mí» devolvería
-- las que quedaran de las 60 primeras, no las 60 impresionistas más cercanas.
-- El texto es exactamente el mismo caso.
--
-- ## Lo que se mide, medido antes de escribirlo
--
-- El presupuesto es el `statement_timeout` de 3 s del rol `anon`. Tres formas
-- del filtro, sobre tres puntos y dos términos:
--
--                        solo título   + artista   + traducción
--     Barcelona  50 km      395 ms        41 ms        54 ms
--     Nueva York  5 km    2.426 ms       299 ms       991 ms
--     Madrid    200 km      872 ms       311 ms       406 ms
--
-- La forma completa cabe con holgura, así que se coge la completa: buscar solo
-- en `artworks.title` dejaría fuera al que escribe el título en su idioma
-- —que es la mitad del sentido de tener traducciones— y al que escribe el
-- nombre del pintor, que es como busca la gente. Los 2.426 ms de «solo título»
-- son de caché fría; se cuentan porque el usuario también los paga.
--
-- Que buscar por MÁS columnas salga más barato que por menos no es un error de
-- lectura: al combinarse con `artists_name_trgm` y con
-- `artwork_translations_title_trgm`, el planificador escoge otro camino que
-- cuando solo puede mirar `artworks.title`.
--
-- CORREGIDO después de medirlo: al escribir esto supuse que el que se ponía a
-- trabajar era `artworks_title_trgm` —25 MB con `idx_scan = 0` desde siempre—.
-- No es verdad. Comprobado en `pg_stat_user_indexes` tras usar la función:
-- `artists_name_trgm` va por 1.932 lecturas y `artwork_translations_title_trgm`
-- por 3; `artworks_title_trgm` **sigue en 0**. Es parcial sobre `published` y no
-- lo usa nadie: sigue siendo peso muerto, y sigue apuntado en NOTAS.
--
-- ## Menos de dos letras no es una búsqueda
--
-- Se trata como si no hubiera filtro. Una sola letra recorrería el radio entero
-- para devolver casi todo, y lo que hay detrás es alguien escribiendo, no
-- alguien preguntando. Lo mismo hace la ruta de Nominatim con tres.
--
-- Hay que borrar la versión de seis argumentos antes de crear la de siete: con
-- las dos vivas, una llamada por nombre que diera los seis de siempre encajaría
-- en ambas y PostgREST se encontraría con «function is not unique».
-- ============================================================================

set search_path = public, extensions;

drop function if exists artworks_near(double precision, double precision, text, int, text, int);

create or replace function artworks_near(
  lat           double precision,
  lng           double precision,
  p_lang        text default 'es',
  radius_m      int  default 5000,
  movement_slug text default null,
  max_results   int  default 100,
  search_text   text default null
)
returns table (
  id bigint, title text, slug text, image_url text, year_start int, date_display text,
  artist_name text, institution_name text, institution_slug text,
  distance_m double precision,
  rights_status text, thumbnail_url text, origin_url text, image_mode text
)
language sql stable security definer set search_path = public, extensions as $fn$
  with q as (
    -- Una sola letra, o espacios, valen lo mismo que no filtrar.
    select case when length(btrim(coalesce(search_text, ''))) >= 2
                then '%' || btrim(search_text) || '%' end as patron
  ),
  cerca as (
    -- Paso 1: quiénes. Sin traducciones salvo cuando hay que buscar en ellas.
    select a.id,
           a.notability,
           st_distance(a.location, st_makepoint(lng, lat)::geography) as distancia
      from artworks a
      left join artists ar on ar.id = a.artist_id
     cross join q
     where a.status = 'published'
       and a.image_url is not null
       and st_dwithin(a.location, st_makepoint(lng, lat)::geography, radius_m)
       and (movement_slug is null or exists (
             select 1 from artwork_movements am
               join movements m on m.id = am.movement_id
              where am.artwork_id = a.id and m.slug = movement_slug))
       and (q.patron is null
            or a.title ilike q.patron
            or ar.name ilike q.patron
            or exists (select 1 from artwork_translations tw
                        where tw.artwork_id = a.id and tw.title ilike q.patron))
     order by a.notability desc, distancia asc, a.id
     limit max_results
  )
  -- Paso 2: cómo se llaman. Ya solo sobre las elegidas.
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display,
         coalesce(ta.name, ar.name),
         coalesce(ti.name, i.name),
         i.slug,
         c.distancia,
         a.rights_status, a.thumbnail_url, a.origin_url,
         image_mode(a.rights_status, a.image_url, a.thumbnail_url)
    from cerca c
    join artworks a on a.id = c.id
    left join artists ar     on ar.id = a.artist_id
    left join institutions i on i.id  = a.institution_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
    left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
   -- El join no conserva el orden del paso 1, así que se repite aquí.
   order by c.notability desc, c.distancia asc, a.id
$fn$;

grant execute on function artworks_near(double precision, double precision, text, int, text, int, text)
  to anon, authenticated;
