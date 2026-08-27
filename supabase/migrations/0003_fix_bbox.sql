-- ============================================================================
-- Artlas · corrección de `institutions_in_bbox`
--
-- SÍNTOMA: el mapa mundial salía sin ninguna chincheta, con la base de datos
-- llena (3.324 obras, contadores correctos) y sin ningún error.
--
-- CAUSA: la función comparaba con `st_intersects(geography, geography)` sobre
-- un rectángulo construido con `st_makeenvelope`. En el tipo `geography` los
-- lados de un polígono son arcos de círculo máximo, no líneas rectas en
-- lat/lon, y un rectángulo que abarca los 360° de longitud se vuelve
-- degenerado: PostGIS no lo interpreta como "todo el mundo" sino como una
-- figura vacía. Medido con la misma función:
--
--     bbox -180..180  ->  0 museos     <- el mapa mundial
--     bbox -179..179  ->  0 museos
--     bbox  -10..30   ->  6 museos     <- Europa, correcto
--     bbox   -4..-3   ->  2 museos     <- Madrid, correcto
--
-- Lo peor del fallo es que no da error: devuelve cero filas, que es una
-- respuesta perfectamente válida, y parece que no hay datos.
--
-- ARREGLO: comparar cajas en el plano lat/lon con el operador `&&` sobre
-- `geometry`. Para PUNTOS, la comparación de cajas equivale a la intersección
-- exacta, así que no se pierde precisión, y además `&&` se resuelve con
-- índice, que es más rápido que `st_intersects`.
-- ============================================================================

set search_path = public, extensions;

-- El índice existente es sobre `geography`; `&&` sobre `geometry` necesita el
-- suyo, o el mapa acabaría haciendo un recorrido completo de la tabla.
create index if not exists institutions_geom_idx
  on institutions using gist ((location::geometry));

create or replace function institutions_in_bbox(
  west double precision, south double precision,
  east double precision, north double precision,
  p_lang text default 'es'
)
returns table (
  id bigint, name text, slug text, city text, country text,
  lat double precision, lng double precision,
  artwork_count int, rating_avg numeric
)
language sql stable set search_path = public, extensions as $fn$
  select i.id,
         coalesce(ti.name, i.name),
         i.slug,
         coalesce(ti.city, i.city),
         coalesce(ti.country, i.country),
         st_y(i.location::geometry), st_x(i.location::geometry),
         i.artwork_count, i.rating_avg
    from institutions i
    left join institution_translations ti
      on ti.institution_id = i.id and ti.lang = p_lang
   where i.artwork_count > 0
     and i.location is not null
     and i.location::geometry && st_makeenvelope(west, south, east, north, 4326)
   order by i.artwork_count desc
$fn$;
