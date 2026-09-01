-- ============================================================================
-- Artlas · 0041 — que buscar no se caiga con una palabra corriente
--
-- `/es/buscar?q=portrait` devolvía «Application error: a server-side exception
-- has occurred». No era el texto «portrait»: era el reloj. El rol `anon` corta
-- a los 3 s y la función tardaba más, así que el corte llegaba antes que la
-- respuesta y la página moría. Medido en producción:
--
--   portrait  1,4 s  pasa        landscape  2,9 s  pasa por los pelos
--   saint     2,3 s  pasa        «a»        3,4 s  SE CAE
--   woman     2,3 s  pasa        «de»       3,6 s  SE CAE
--
-- Por eso era «a veces»: las búsquedas corrientes viven a un pelo del límite y
-- caen del lado bueno o del malo según lo caliente que esté la caché. El
-- `revalidate = 3600` de la página remataba el disfraz: la primera visita se
-- caía y la siguiente, ya cacheada, iba bien.
--
-- ## De dónde salía el tiempo
--
-- Contando lo que se pedía a la base, rama por rama, con «de»:
--
--   texto (es)        0 obras
--   texto (en)    6.710 obras
--   artistas     12.832 obras   ← `ilike '%de%'` casa con 12.832 nombres
--   museos      131.081 obras   ← y con casi todos los museos
--
-- Las dos ramas de `ilike` no buscan: **abren en abanico**. «de» aparece en
-- «Museo del Prado» y en «Musée d'Orsay», y de ahí salen las 131.081 obras de
-- esos museos. Luego las 150.000 candidatas se juntaban con seis `left join`
-- de traducciones, se ordenaban enteras… y se devolvían 36.
--
-- ## Los dos cambios
--
-- **1. Cada rama trae solo lo que puede salir.** Si la página pide 36 obras a
-- partir de la 0, ninguna rama necesita dar más de 36: las demás no caben. El
-- recorte es exacto y no una aproximación, y por un motivo concreto: cada rama
-- se ordena por LA MISMA clave que el orden final. Las de artista y museo
-- puntúan constante (0,6 y 0,3), así que dentro de ellas manda `notability`; y
-- para eso ya existen los índices parciales de `0009`, `(artist_id, notability
-- desc)` y `(institution_id, notability desc)`. Se entra por `lateral`, un
-- salto por artista o por museo, en vez de traerse el abanico entero.
--
-- **2. Los seis `left join` se hacen al final.** Antes se pagaban por las
-- 150.000 candidatas y luego se tiraban casi todas. Ahora se elige primero
-- —id, puntuación y notoriedad, tres columnas— y solo las 36 supervivientes
-- se completan con título, artista, museo y traducciones.
--
-- ## Lo que NO cambia: los resultados
--
-- Comprobado antes de escribir esto, comparando la función vieja y la nueva
-- fila a fila: 19 búsquedas en dos idiomas, 16 combinaciones de filtros y
-- paginación —incluida la página 10—, y 8 casos buscados a propósito para
-- romperlo. **Los mismos ids, en el mismo orden, en las 43.**
--
-- Esa última tanda encontró un fallo de verdad, y de ahí viene la parte más
-- fea del SQL. La primera versión recortaba y filtraba DESPUÉS: «rembrandt»
-- filtrado por grabado devolvía 13 obras donde antes había 37, porque el
-- recorte se quedaba con las 37 más notables de Rembrandt —casi todas
-- pinturas— y el filtro las barría luego. Los filtros van DENTRO del recorte,
-- repetidos en las dos ramas. Es feo y es lo correcto.
--
-- ## Lo que esto no arregla
--
-- Sigue habiendo un límite de 3 s y una instancia compartida con la caché
-- fría. Esto baja el trabajo entre 3 y 38 veces —«de» pasa de 3.108.956
-- bloques a 81.610—, pero no vuelve imposible pasarse. Por eso va acompañado
-- de que la página aguante el corte en vez de romperse, y de que
-- `check-perf` mida por fin una búsqueda ancha: medía «goya» y «meninas»,
-- las dos baratas, y por eso daba todo por bueno mientras la web se caía.
--
-- Solo reemplaza una función: se puede aplicar con una ingesta viva.
-- ============================================================================

set search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.search_artworks(
  p_query text, p_lang text default 'es', p_movement text default null, p_artist text default null,
  p_country text default null, p_year_from integer default null, p_year_to integer default null,
  p_category text default null, max_results integer default 50, p_offset integer default 0, p_city text default null)
returns table(id bigint, title text, slug text, image_url text, year_start integer, date_display text,
  category text, artist_name text, artist_slug text, institution_name text, institution_slug text,
  city text, country text, notability integer, rank real, rights_status text, thumbnail_url text,
  origin_url text, image_mode text)
language plpgsql stable security definer set search_path to 'public','extensions'
as $function$
declare
  cfg regconfig; tsq tsquery; tsq_en tsquery; needle text; tope integer;
begin
  if p_query is null or btrim(p_query) = '' then
    return query
      select a.id, coalesce(tw.title, tw_en.title, a.title), a.slug, a.image_url, a.year_start,
             a.date_display, a.category, coalesce(ta.name, ar.name), ar.slug,
             coalesce(ti.name, i.name), i.slug, coalesce(ti.city, i.city), coalesce(ti.country, i.country),
             a.notability, 0::real, a.rights_status, a.thumbnail_url, a.origin_url,
             image_mode(a.rights_status, a.image_url, a.thumbnail_url)
        from artworks a
        left join artists ar on ar.id = a.artist_id
        left join institutions i on i.id = a.institution_id
        left join artwork_translations tw on tw.artwork_id = a.id and tw.lang = p_lang
        left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
        left join artist_translations ta on ta.artist_id = ar.id and ta.lang = p_lang
        left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
       where a.status = 'published'
         and (p_movement is null or exists (select 1 from artwork_movements am join movements m on m.id = am.movement_id where am.artwork_id = a.id and m.slug = p_movement))
         and (p_artist is null or ar.slug = p_artist)
         and (p_country is null or i.country_code = upper(p_country))
         and (p_city is null or i.city = p_city)
         and (p_year_from is null or a.year_start >= p_year_from)
         and (p_year_to is null or a.year_start <= p_year_to)
         and (p_category is null or a.category = p_category)
       order by a.notability desc, a.id
       limit max_results offset p_offset;
    return;
  end if;

  cfg := coalesce((select l.ts_config from languages l where l.code = p_lang), 'simple'::regconfig);
  tsq := websearch_to_tsquery(cfg, public.immutable_unaccent(p_query));
  tsq_en := websearch_to_tsquery('english', public.immutable_unaccent(p_query));
  needle := '%' || public.immutable_unaccent(btrim(p_query)) || '%';
  tope := p_offset + max_results;

  return query
  with art as materialized (
    select ar2.id from artists ar2 where public.immutable_unaccent(ar2.name) ilike needle
  ),
  mus as materialized (
    select i3.id from institutions i3
     where public.immutable_unaccent(i3.name) ilike needle
        or exists (select 1 from institution_translations it
                    where it.institution_id = i3.id and public.immutable_unaccent(it.name) ilike needle)
  ),
  candidatas as (
    select tw.artwork_id, ts_rank(tw.search_vector, tsq) as score
      from artwork_translations tw where tw.lang = p_lang and tw.search_vector @@ tsq
    union all
    select tw.artwork_id, ts_rank(tw.search_vector, tsq_en)
      from artwork_translations tw where tw.lang = 'en' and tw.search_vector @@ tsq_en
    union all
    select x.id, 0.6::real from art cross join lateral (
      select a2.id, a2.notability from artworks a2
       where a2.artist_id = art.id and a2.status = 'published'
       and (p_year_from is null or a2.year_start >= p_year_from)
       and (p_year_to is null or a2.year_start <= p_year_to)
       and (p_category is null or a2.category = p_category)
       and (p_movement is null or exists (select 1 from artwork_movements am join movements mv on mv.id = am.movement_id where am.artwork_id = a2.id and mv.slug = p_movement))
       and (p_artist is null or exists (select 1 from artists arx where arx.id = a2.artist_id and arx.slug = p_artist))
       and (p_country is null or exists (select 1 from institutions ix where ix.id = a2.institution_id and ix.country_code = upper(p_country)))
       and (p_city is null or exists (select 1 from institutions ix where ix.id = a2.institution_id and ix.city = p_city))
       order by a2.notability desc, a2.id limit tope) x
    union all
    select y.id, 0.3::real from mus cross join lateral (
      select a3.id, a3.notability from artworks a3
       where a3.institution_id = mus.id and a3.status = 'published'
       and (p_year_from is null or a3.year_start >= p_year_from)
       and (p_year_to is null or a3.year_start <= p_year_to)
       and (p_category is null or a3.category = p_category)
       and (p_movement is null or exists (select 1 from artwork_movements am join movements mv on mv.id = am.movement_id where am.artwork_id = a3.id and mv.slug = p_movement))
       and (p_artist is null or exists (select 1 from artists arx where arx.id = a3.artist_id and arx.slug = p_artist))
       and (p_country is null or exists (select 1 from institutions ix where ix.id = a3.institution_id and ix.country_code = upper(p_country)))
       and (p_city is null or exists (select 1 from institutions ix where ix.id = a3.institution_id and ix.city = p_city))
       order by a3.notability desc, a3.id limit tope) y
  ),
  mejores as (select c.artwork_id, max(c.score) as score from candidatas c group by c.artwork_id),
  elegidas as (
    select m.artwork_id, m.score, a.notability
      from mejores m
      join artworks a on a.id = m.artwork_id
      left join artists ar on ar.id = a.artist_id
      left join institutions i on i.id = a.institution_id
     where a.status = 'published'
       and (p_movement is null or exists (select 1 from artwork_movements am join movements mv on mv.id = am.movement_id where am.artwork_id = a.id and mv.slug = p_movement))
       and (p_artist is null or ar.slug = p_artist)
       and (p_country is null or i.country_code = upper(p_country))
       and (p_city is null or i.city = p_city)
       and (p_year_from is null or a.year_start >= p_year_from)
       and (p_year_to is null or a.year_start <= p_year_to)
       and (p_category is null or a.category = p_category)
     order by m.score desc, a.notability desc, a.id
     limit max_results offset p_offset
  )
  select a.id, coalesce(tw.title, tw_en.title, a.title), a.slug, a.image_url, a.year_start,
         a.date_display, a.category, coalesce(ta.name, ar.name), ar.slug,
         coalesce(ti.name, i.name), i.slug, coalesce(ti.city, i.city), coalesce(ti.country, i.country),
         a.notability, e.score::real, a.rights_status, a.thumbnail_url, a.origin_url,
         image_mode(a.rights_status, a.image_url, a.thumbnail_url)
    from elegidas e
    join artworks a on a.id = e.artwork_id
    left join artists ar on ar.id = a.artist_id
    left join institutions i on i.id = a.institution_id
    left join artwork_translations tw on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join artist_translations ta on ta.artist_id = ar.id and ta.lang = p_lang
    left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
   order by e.score desc, a.notability desc, a.id;
end $function$;
