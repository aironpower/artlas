-- ============================================================================
-- Artlas · 0032 — filtrar por ciudad dentro de un país
--
-- El filtro de país llevaba a «Estados Unidos, 34.000 obras», que no es un
-- filtro sino otro catálogo. La ciudad es la unidad con la que se piensa
-- cuando se busca arte: se va a Nueva York, no a Estados Unidos.
--
-- Va como subfiltro y no como filtro suelto porque una lista de todas las
-- ciudades del mundo no ayuda a nadie; colgando del país, son cinco o diez.
--
-- Se filtra por `i.city`, el nombre canónico, y no por el traducido: el
-- desplegable enseña «Nueva York» pero manda «New York», que es lo que no
-- cambia al cambiar de idioma. Filtrar por la traducción haría que el mismo
-- enlace diera resultados distintos en cada idioma.
--
-- El cuerpo de la función NO está transcrito a mano: se sacó el que había con
-- `pg_get_functiondef` y se le insertó la condición detrás de cada una de las
-- dos de país —la rama rápida y la general de 0015—. Copiarlo a mano habría
-- sido la forma más fácil de perder una línea por el camino.
--
-- Solo reemplaza una función: se puede aplicar con una ingesta viva.
-- ============================================================================

set search_path = public, extensions;

/*
 * Se borra la versión de diez argumentos antes de crear la de once: sin esto
 * quedarían las dos y PostgREST elegiría por su cuenta cuál llamar.
 */
drop function if exists search_artworks(text, text, text, text, text, integer, integer, text, integer, integer);

CREATE OR REPLACE FUNCTION public.search_artworks(p_query text, p_lang text DEFAULT 'es'::text, p_movement text DEFAULT NULL::text, p_artist text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_year_from integer DEFAULT NULL::integer, p_year_to integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text, max_results integer DEFAULT 50, p_offset integer DEFAULT 0, p_city text DEFAULT NULL)
 RETURNS TABLE(id bigint, title text, slug text, image_url text, year_start integer, date_display text, category text, artist_name text, artist_slug text, institution_name text, institution_slug text, city text, country text, notability integer, rank real, rights_status text, thumbnail_url text, origin_url text, image_mode text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  cfg    regconfig;
  tsq    tsquery;
  tsq_en tsquery;
  needle text;
begin
  if p_query is null or btrim(p_query) = '' then
    return query
      select a.id,
             coalesce(tw.title, tw_en.title, a.title),
             a.slug, a.image_url, a.year_start, a.date_display, a.category,
             coalesce(ta.name, ar.name), ar.slug,
             coalesce(ti.name, i.name), i.slug,
             coalesce(ti.city, i.city), coalesce(ti.country, i.country),
             a.notability,
             0::real,
             a.rights_status, a.thumbnail_url, a.origin_url,
             image_mode(a.rights_status, a.image_url, a.thumbnail_url)
        from artworks a
        left join artists ar     on ar.id = a.artist_id
        left join institutions i on i.id  = a.institution_id
        left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
        left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
        left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
        left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
       where a.status = 'published'
         and (p_movement is null or exists (
               select 1 from artwork_movements am join movements m on m.id = am.movement_id
                where am.artwork_id = a.id and m.slug = p_movement))
         and (p_artist    is null or ar.slug = p_artist)
         and (p_country   is null or i.country_code = upper(p_country))
         and (p_city      is null or i.city = p_city)
         and (p_year_from is null or a.year_start >= p_year_from)
         and (p_year_to   is null or a.year_start <= p_year_to)
         and (p_category  is null or a.category = p_category)
       order by a.notability desc, a.id
       limit max_results offset p_offset;
    return;
  end if;

  cfg := coalesce((select l.ts_config from languages l where l.code = p_lang), 'simple'::regconfig);
  tsq    := websearch_to_tsquery(cfg, public.immutable_unaccent(p_query));
  tsq_en := websearch_to_tsquery('english', public.immutable_unaccent(p_query));
  needle := '%' || public.immutable_unaccent(btrim(p_query)) || '%';

  return query
    with candidatas as (
      select tw.artwork_id, ts_rank(tw.search_vector, tsq) as score
        from artwork_translations tw
       where tw.lang = p_lang and tw.search_vector @@ tsq
      union all
      select tw.artwork_id, ts_rank(tw.search_vector, tsq_en)
        from artwork_translations tw
       where tw.lang = 'en' and tw.search_vector @@ tsq_en
      union all
      select a2.id, 0.6::real
        from artists ar2
        join artworks a2 on a2.artist_id = ar2.id
       where public.immutable_unaccent(ar2.name) ilike needle
         and a2.status = 'published'
      union all
      select a3.id, 0.3::real
        from institutions i3
        join artworks a3 on a3.institution_id = i3.id
       where a3.status = 'published'
         and (public.immutable_unaccent(i3.name) ilike needle
              or exists (select 1 from institution_translations it
                          where it.institution_id = i3.id
                            and public.immutable_unaccent(it.name) ilike needle))
    ),
    mejores as (
      select c.artwork_id, max(c.score) as score from candidatas c group by c.artwork_id
    )
    select a.id,
           coalesce(tw.title, tw_en.title, a.title),
           a.slug, a.image_url, a.year_start, a.date_display, a.category,
           coalesce(ta.name, ar.name), ar.slug,
           coalesce(ti.name, i.name), i.slug,
           coalesce(ti.city, i.city), coalesce(ti.country, i.country),
           a.notability,
           m.score::real,
           a.rights_status, a.thumbnail_url, a.origin_url,
           image_mode(a.rights_status, a.image_url, a.thumbnail_url)
      from mejores m
      join artworks a on a.id = m.artwork_id
      left join artists ar     on ar.id = a.artist_id
      left join institutions i on i.id  = a.institution_id
      left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
      left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
      left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
      left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
     where a.status = 'published'
       and (p_movement is null or exists (
             select 1 from artwork_movements am join movements mv on mv.id = am.movement_id
              where am.artwork_id = a.id and mv.slug = p_movement))
       and (p_artist    is null or ar.slug = p_artist)
       and (p_country   is null or i.country_code = upper(p_country))
         and (p_city      is null or i.city = p_city)
       and (p_year_from is null or a.year_start >= p_year_from)
       and (p_year_to   is null or a.year_start <= p_year_to)
       and (p_category  is null or a.category = p_category)
     order by m.score desc, a.notability desc, a.id
     limit max_results offset p_offset;
end $function$
;
