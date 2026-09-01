-- ============================================================================
-- Artlas · 0040 — «obras cerca de mí», en dos pasos
--
-- `npm run check-perf` marca esta consulta con aviso desde hace tiempo:
--
--     !   2383 ms  cerca de mí (Prado, 2 km)    60 filas
--
-- El rol `anon` corta a los 3.000 ms, así que la función que sostiene el mapa
-- —que es el producto— trabaja al 79% de su presupuesto. Los 2.383 ms son de
-- caché fría; en caliente iba a 170 ms. Pero lo que la hace cara en frío se ve
-- en el plan, y es una cifra sola:
--
--     Buffers: shared hit=91888
--
-- **718 MB de lecturas lógicas para devolver 60 obras.** No es el filtro
-- espacial, que resuelve en 83 ms: es que las cuatro tablas de traducciones se
-- unían a las 4.663 candidatas que caen dentro del radio, y el `limit 60` se
-- aplicaba al final, cuando el trabajo ya estaba hecho. Se traducían 4.663
-- obras para enseñar 60.
--
-- Aquí se hace en dos pasos, que es exactamente lo que la migración `0025` le
-- hizo a la paginación del buscador por este mismo motivo: primero se eligen
-- las 60 mirando solo `artworks`, y después se les cuelgan los textos.
--
-- Medido sobre el catálogo real, antes y después:
--
--     Prado, 2 km          170 ms · 91.888 buffers  →   79 ms · 34.975
--     Nueva York, 5 km     423 ms · 236.844         →  107 ms · 100.245
--
-- Entre un 58% y un 75% menos de trabajo. Nueva York es el caso que más
-- importa: cuanto más grande el radio y más museos alrededor, más candidatas
-- se traducían para nada.
--
-- ## Un desempate que no es adorno
--
-- Se añade `a.id` al final del orden. Con `notability` y distancia iguales
-- —y lo son a menudo: todas las obras de un museo comparten su punto, así que
-- comparten distancia— el `limit 60` se quedaba con sesenta cualesquiera, y dos
-- llamadas iguales podían devolver conjuntos distintos. Es el mismo desempate
-- que la auditoría de imágenes tuvo que aprender a poner.
--
-- El filtro por movimiento va DENTRO del primer paso, no fuera: si se aplicara
-- después del `limit`, pedir «impresionismo cerca de mí» devolvería las que
-- quedaran de las 60 más cercanas, en vez de las 60 impresionistas más
-- cercanas. Es la trampa de partir una consulta en dos y hay que decirla.
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
  distance_m double precision,
  rights_status text, thumbnail_url text, origin_url text, image_mode text
)
language sql stable security definer set search_path = public, extensions as $fn$
  with cerca as (
    -- Paso 1: quiénes. Solo `artworks`, ningún texto, ninguna traducción.
    select a.id,
           a.notability,
           st_distance(a.location, st_makepoint(lng, lat)::geography) as distancia
      from artworks a
     where a.status = 'published'
       and a.image_url is not null
       and st_dwithin(a.location, st_makepoint(lng, lat)::geography, radius_m)
       and (movement_slug is null or exists (
             select 1 from artwork_movements am
               join movements m on m.id = am.movement_id
              where am.artwork_id = a.id and m.slug = movement_slug))
     order by a.notability desc, distancia asc, a.id
     limit max_results
  )
  -- Paso 2: cómo se llaman. Ya solo sobre las 60 elegidas.
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

grant execute on function artworks_near(double precision, double precision, text, int, text, int)
  to anon, authenticated;
