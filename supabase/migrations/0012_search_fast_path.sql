-- ============================================================================
-- Artlas · 0012 — el buscador deja de recorrer el catálogo para no buscar nada
--
-- Con 113.783 obras, `next build` se cayó prerenderizando la portada:
--
--     Error: búsqueda: canceling statement due to statement timeout
--
-- La portada pide 12 obras SIN consulta de texto. La función calculaba igual
-- la puntuación de relevancia de cada fila —cuatro comparaciones, dos de ellas
-- ts_rank— y ordenaba por ella. Con 6.000 obras eso era gratis. Con 113.000
-- son 113.000 puntuaciones que valen todas cero, seguidas de una ordenación
-- completa, y encima esa ordenación impide usar el índice de notoriedad porque
-- la primera clave es una expresión calculada.
--
-- El arreglo es reconocer que navegar y buscar son dos consultas distintas
-- disfrazadas de una. Sin texto: ordenar por notoriedad, que está indexada.
-- Con texto: lo de siempre, y entonces sí compensa puntuar.
--
-- La función pasa a plpgsql para poder ramificar. La firma no cambia, así que
-- la app no se entera.
-- ============================================================================

set search_path = public, extensions;

/**
 * Buscador del catálogo.
 *
 * Nota sobre `a.status = 'published'`: aparece explícito aquí aunque la
 * política RLS ya lo garantice. No es redundancia defensiva, es que el
 * planificador necesita ver la condición para poder usar los índices
 * PARCIALES de 0009, que están definidos justamente sobre `published`. Sin
 * ella se recorre la tabla entera, incluidas las 59.000 obras que esperan
 * datos y que nadie va a mostrar nunca.
 */
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
language plpgsql stable set search_path = public, extensions as $fn$
declare
  cfg    regconfig;
  tsq    tsquery;
  tsq_en tsquery;
  needle text;
begin
  -- ---------------------------------------------------------------------
  -- Navegar: sin texto no hay nada que puntuar
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
  -- Buscar: aquí sí compensa puntuar
  -- ---------------------------------------------------------------------
  cfg := coalesce((select l.ts_config from languages l where l.code = p_lang), 'simple'::regconfig);
  tsq    := websearch_to_tsquery(cfg, public.immutable_unaccent(p_query));
  tsq_en := websearch_to_tsquery('english', public.immutable_unaccent(p_query));
  needle := '%' || public.immutable_unaccent(btrim(p_query)) || '%';

  return query
    select a.id,
           coalesce(tw.title, tw_en.title, a.title),
           a.slug, a.image_url, a.year_start, a.date_display, a.category,
           coalesce(ta.name, ar.name), ar.slug,
           coalesce(ti.name, i.name), i.slug,
           coalesce(ti.city, i.city), coalesce(ti.country, i.country),
           a.notability,
           greatest(
             coalesce(ts_rank(tw.search_vector, tsq), 0),
             coalesce(ts_rank(tw_en.search_vector, tsq_en), 0),
             case when public.immutable_unaccent(ar.name) ilike needle then 0.6 else 0 end,
             case when public.immutable_unaccent(coalesce(ti.name, i.name)) ilike needle
                  then 0.3 else 0 end
           )::real
      from artworks a
      left join artists ar     on ar.id = a.artist_id
      left join institutions i on i.id  = a.institution_id
      left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
      left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
      left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
      left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
     where a.status = 'published'
       and (tw.search_vector    @@ tsq
            or tw_en.search_vector @@ tsq_en
            or public.immutable_unaccent(ar.name) ilike needle
            or public.immutable_unaccent(coalesce(ti.name, i.name)) ilike needle)
       and (p_movement is null or exists (
             select 1 from artwork_movements am join movements m on m.id = am.movement_id
              where am.artwork_id = a.id and m.slug = p_movement))
       and (p_artist    is null or ar.slug = p_artist)
       and (p_country   is null or i.country_code = upper(p_country))
       and (p_year_from is null or a.year_start >= p_year_from)
       and (p_year_to   is null or a.year_start <= p_year_to)
       and (p_category  is null or a.category = p_category)
     order by 15 desc, a.notability desc, a.id
     limit max_results;
end $fn$;
