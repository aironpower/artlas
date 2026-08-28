-- ============================================================================
-- Artlas · 0023 — paginar: que el catálogo deje de acabarse en la obra 60
--
-- Hasta aquí ninguna lista podía pasar de su primera pantalla. El Museo del
-- Prado enseñaba 60 obras de sus 3.990 y no había forma de ver la 61; el
-- buscador cortaba en 60 y lo llamaba "60+"; y la ficha de artista hacía lo
-- contrario, volcar hasta 500 de una vez —374 en el caso de Van Gogh—, que en
-- un móvil son 215.000 píxeles de página.
--
-- Se añade `p_offset` a las dos funciones de lista y se estrena
-- `artworks_by_institution`. Los cuerpos de las dos primeras están copiados
-- LETRA POR LETRA de 0018 y 0019, con dos únicos cambios: el parámetro nuevo y
-- el `offset` en cada `limit`. Reescribirlos a mano habría sido perder las dos
-- optimizaciones que costaron encontrarse (la rama sin texto de 0012 y el
-- UNION por índices de 0015).
--
-- Cambian la FIRMA, así que hay que soltarlas antes: `create or replace` no
-- puede añadir parámetros, y dentro de una transacción el fallo tumba la
-- migración entera en silencio.
--
-- No cuentan el total a propósito. Contar 3.990 filas filtradas en cada página
-- se paga en un rol `anon` con `statement_timeout` de 3 s, y no hace falta: los
-- museos y los artistas ya llevan su `artwork_count` (solo publicadas, 0008), y
-- para el buscador basta con pedir una obra más de las que caben para saber si
-- hay página siguiente.
-- ============================================================================

drop function if exists search_artworks(text, text, text, text, text, int, int, text, int);

create function search_artworks(
  p_query       text,
  p_lang        text default 'es',
  p_movement    text default null,
  p_artist      text default null,
  p_country     text default null,
  p_year_from   int  default null,
  p_year_to     int  default null,
  p_category    text default null,
  max_results   int  default 50,
  p_offset      int  default 0
)
returns table (
  id bigint, title text, slug text, image_url text,
  year_start int, date_display text, category text,
  artist_name text, artist_slug text,
  institution_name text, institution_slug text, city text, country text,
  notability int, rank real,
  rights_status text, thumbnail_url text, origin_url text, image_mode text
)
language plpgsql stable security definer set search_path = public, extensions as $fn$
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
       and (p_year_from is null or a.year_start >= p_year_from)
       and (p_year_to   is null or a.year_start <= p_year_to)
       and (p_category  is null or a.category = p_category)
     order by m.score desc, a.notability desc, a.id
     limit max_results offset p_offset;
end $fn$;

grant execute on function search_artworks(text, text, text, text, text, int, int, text, int, int)
  to anon, authenticated;

drop function if exists artworks_by_artist(text, text, int);

create function artworks_by_artist(
  p_slug      text,
  p_lang      text default 'es',
  max_results int  default 500,
  p_offset    int  default 0
)
returns table (
  id bigint, title text, slug text, image_url text,
  year_start int, date_display text, category text,
  institution_id bigint, institution_name text, institution_slug text,
  city text, country text,
  lat double precision, lng double precision,
  notability int,
  rights_status text, thumbnail_url text, origin_url text, image_mode text
)
language sql stable security definer set search_path = public, extensions as $fn$
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
         a.notability,
         a.rights_status, a.thumbnail_url, a.origin_url,
         image_mode(a.rights_status, a.image_url, a.thumbnail_url)
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
   limit max_results offset p_offset
$fn$;

grant execute on function artworks_by_artist(text, text, int, int) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Las obras de un museo, por su museo
--
-- La página de museo pedía "las obras a menos de 50 metros de este punto"
-- reutilizando `artworks_near`, para no repetir la cadena de idiomas. El apaño
-- no se puede paginar y no cuadra con el contador: cuenta por `institution_id`
-- y aquello contaba por geografía. Esta función pregunta lo que la página
-- quiere decir, y devuelve las obras en el mismo orden que el contador cuenta.
-- ----------------------------------------------------------------------------

drop function if exists artworks_by_institution(text, text, int, int);

create function artworks_by_institution(
  p_slug      text,
  p_lang      text default 'es',
  max_results int  default 60,
  p_offset    int  default 0
)
returns table (
  id bigint, title text, slug text, image_url text,
  year_start int, date_display text, category text,
  artist_name text, artist_slug text,
  notability int,
  rights_status text, thumbnail_url text, origin_url text, image_mode text
)
language sql stable security definer set search_path = public, extensions as $fn$
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display, a.category,
         coalesce(ta.name, ar.name),
         ar.slug,
         a.notability,
         a.rights_status, a.thumbnail_url, a.origin_url,
         image_mode(a.rights_status, a.image_url, a.thumbnail_url)
    from artworks a
    join institutions i on i.id = a.institution_id
    left join artists ar on ar.id = a.artist_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
   where i.slug = p_slug
     and a.status = 'published'
   order by a.notability desc, a.year_start asc nulls last, a.id
   limit max_results offset p_offset
$fn$;

grant execute on function artworks_by_institution(text, text, int, int) to anon, authenticated;
