-- ============================================================================
-- Artlas · 0015 — la búsqueda por texto deja de rozar el límite
--
-- Medido por el camino del navegador: buscar "goya" tardaba 2.350 ms de los
-- 3.000 que concede el rol anon. Funcionaba casi siempre, y ese "casi" es lo
-- peor que puede pasar: el usuario ve un 500 de vez en cuando y no hay forma
-- de reproducirlo a voluntad.
--
-- La causa está en la forma de la consulta. Una obra podía coincidir de cuatro
-- maneras, y las cuatro iban en un OR gigante:
--
--     where tw.search_vector @@ tsq
--        or tw_en.search_vector @@ tsq_en
--        or unaccent(artista) ilike '%goya%'
--        or unaccent(museo)   ilike '%goya%'
--
-- Cada condición TIENE su índice, pero unidas por OR sobre cuatro tablas
-- distintas el planificador no puede usar ninguno: no existe un índice que
-- abarque las cuatro. Así que unía todo y filtraba después.
--
-- La solución es la de siempre con los OR: convertirlos en UNION. Cada rama
-- busca en su tabla, usa su índice y devuelve ids; luego se juntan. Se pasa de
-- recorrer el catálogo a leer cuatro listas cortas.
-- ============================================================================

set search_path = public, extensions;

create or replace function search_artworks(
  p_query       text,
  p_lang        text default 'es',
  p_movement    text default null,
  p_artist      text default null,
  p_country     text default null,
  p_year_from   int  default null,
  p_year_to     int  default null,
  p_category    text default null,
  max_results   int  default 50
)
returns table (
  id bigint, title text, slug text, image_url text,
  year_start int, date_display text, category text,
  artist_name text, artist_slug text,
  institution_name text, institution_slug text, city text, country text,
  notability int, rank real
)
language plpgsql stable security definer set search_path = public, extensions as $fn$
declare
  cfg    regconfig;
  tsq    tsquery;
  tsq_en tsquery;
  needle text;
begin
  -- ---------------------------------------------------------------------
  -- Navegar: sin texto no hay nada que puntuar (0012)
  -- ---------------------------------------------------------------------
  if p_query is null or btrim(p_query) = '' then
    return query
      select a.id,
             coalesce(tw.title, tw_en.title, a.title),
             a.slug, a.image_url, a.year_start, a.date_display, a.category,
             coalesce(ta.name, ar.name), ar.slug,
             coalesce(ti.name, i.name), i.slug,
             coalesce(ti.city, i.city), coalesce(ti.country, i.country),
             a.notability,
             0::real
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
         and (p_year_from is null or a.year_start >= p_year_from)
         and (p_year_to   is null or a.year_start <= p_year_to)
         and (p_category  is null or a.category = p_category)
       order by a.notability desc, a.id
       limit max_results;
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- Buscar: cada rama con su índice, y luego se juntan
  -- ---------------------------------------------------------------------
  cfg := coalesce((select l.ts_config from languages l where l.code = p_lang), 'simple'::regconfig);
  tsq    := websearch_to_tsquery(cfg, public.immutable_unaccent(p_query));
  tsq_en := websearch_to_tsquery('english', public.immutable_unaccent(p_query));
  needle := '%' || public.immutable_unaccent(btrim(p_query)) || '%';

  return query
    with candidatas as (
      -- Texto en el idioma pedido (índice GIN sobre search_vector)
      select tw.artwork_id, ts_rank(tw.search_vector, tsq) as score
        from artwork_translations tw
       where tw.lang = p_lang and tw.search_vector @@ tsq

      union all

      -- Texto en inglés: la red de seguridad, único idioma con cobertura total
      select tw.artwork_id, ts_rank(tw.search_vector, tsq_en)
        from artwork_translations tw
       where tw.lang = 'en' and tw.search_vector @@ tsq_en

      union all

      -- Nombre del artista (índice trigrama sobre artists)
      select a2.id, 0.6::real
        from artists ar2
        join artworks a2 on a2.artist_id = ar2.id
       where public.immutable_unaccent(ar2.name) ilike needle
         and a2.status = 'published'

      union all

      -- Nombre del museo, en el idioma pedido o en el neutro
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
      -- Una obra puede coincidir por varias vías; se queda con la mejor.
      select c.artwork_id, max(c.score) as score
        from candidatas c
       group by c.artwork_id
    )
    select a.id,
           coalesce(tw.title, tw_en.title, a.title),
           a.slug, a.image_url, a.year_start, a.date_display, a.category,
           coalesce(ta.name, ar.name), ar.slug,
           coalesce(ti.name, i.name), i.slug,
           coalesce(ti.city, i.city), coalesce(ti.country, i.country),
           a.notability,
           m.score::real
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
       and (p_year_from is null or a.year_start >= p_year_from)
       and (p_year_to   is null or a.year_start <= p_year_to)
       and (p_category  is null or a.category = p_category)
     order by m.score desc, a.notability desc, a.id
     limit max_results;
end $fn$;
