-- ============================================================================
-- Artlas · 0005 — el buscador encuentra por palabra
--
-- Tres fallos medidos contra el catálogo real (6.460 obras):
--
-- 1. La búsqueda solo miraba el vector del idioma pedido. La cobertura de
--    traducciones es parcial por naturaleza —Wikidata no etiqueta todo en los
--    siete idiomas— y el reparto era: en 100%, fr 80%, de 58%, it 51%, nl 50%,
--    es 48%, pt 23%. O sea que buscando en español el 52% del catálogo era
--    inencontrable, y en portugués el 77%. El TÍTULO ya caía al inglés cuando
--    faltaba la traducción; la BÚSQUEDA no, así que la app mostraba obras que
--    ella misma era incapaz de encontrar.
--
-- 2. El nombre del artista no estaba en ningún vector. Buscar "velazquez"
--    devolvía resultados de chiripa, porque el nombre aparecía en la
--    descripción de sus cuadros; buscar "goya" encontraba solo los títulos que
--    llevan "(Goya)" como desambiguador de Wikidata. Con 1.329 artistas en el
--    catálogo, buscar por autor es de los primeros gestos del usuario.
--
-- 3. Lo mismo con el nombre del museo: "prado" o "louvre" no llevaban a sus
--    fondos.
--
-- La corrección no toca las tablas ni reindexa nada: solo cambia el WHERE y la
-- fórmula de relevancia de `search_artworks`.
-- ============================================================================

set search_path = public, extensions;

/**
 * Buscador principal del catálogo.
 *
 * Cuatro maneras de que una obra coincida, en orden de peso:
 *
 *   1. Su texto en el idioma pedido, con el diccionario de ese idioma.
 *   2. Su texto en inglés, con el diccionario inglés. Es la red de seguridad:
 *      el inglés cubre el 100% del catálogo, así que ninguna obra queda fuera
 *      del alcance del buscador por no estar traducida. No hace falta mirar
 *      los otros cinco idiomas para eso.
 *   3. El nombre del artista.
 *   4. El nombre del museo, en el idioma pedido o en el neutro.
 *
 * Los nombres se comparan con ILIKE sobre `immutable_unaccent`, que es la
 * expresión exacta de los índices trigrama de 0001 (`artists_name_trgm`,
 * `institution_translations_name_trgm`): así "picasso" encuentra a "Pablo
 * Picasso" por subcadena y sigue usando índice en vez de recorrer la tabla.
 *
 * La relevancia se calcula una sola vez en un LATERAL y no tres veces repetida
 * entre el SELECT y el ORDER BY. Un acierto por nombre de autor pesa más que
 * cualquier ts_rank (que rara vez pasa de 0,1): quien escribe "Monet" quiere
 * los cuadros de Monet primero, ordenados por notoriedad, no una obra ajena
 * cuya descripción lo menciona de pasada.
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
language sql stable set search_path = public, extensions as $fn$
  with cfg as (
    select coalesce(
      (select ts_config from languages where code = p_lang), 'simple'::regconfig
    ) as ts
  ),
  q as (
    select
      case when p_query is null or btrim(p_query) = '' then null
           else websearch_to_tsquery((select ts from cfg), public.immutable_unaccent(p_query))
      end as tsq,
      case when p_query is null or btrim(p_query) = '' then null
           else websearch_to_tsquery('english', public.immutable_unaccent(p_query))
      end as tsq_en,
      -- Para el ILIKE por subcadena. NULL cuando no hay consulta, para que el
      -- patrón no se convierta en '%%' y haga coincidir a todo el mundo.
      case when p_query is null or btrim(p_query) = '' then null
           else '%' || public.immutable_unaccent(btrim(p_query)) || '%'
      end as needle
  )
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display, a.category,
         coalesce(ta.name, ar.name), ar.slug,
         coalesce(ti.name, i.name), i.slug,
         coalesce(ti.city, i.city), coalesce(ti.country, i.country),
         a.notability,
         score.value
    from artworks a
    left join artists ar     on ar.id = a.artist_id
    left join institutions i on i.id  = a.institution_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
    left join institution_translations ti on ti.institution_id = i.id and ti.lang = p_lang
    cross join lateral (
      select case
        when (select tsq from q) is null then 0::real
        else greatest(
          coalesce(ts_rank(tw.search_vector,    (select tsq    from q)), 0),
          coalesce(ts_rank(tw_en.search_vector, (select tsq_en from q)), 0),
          case when public.immutable_unaccent(ar.name) ilike (select needle from q)
               then 0.6 else 0 end,
          case when public.immutable_unaccent(coalesce(ti.name, i.name)) ilike (select needle from q)
               then 0.3 else 0 end
        )::real
      end as value
    ) score
   where ((select tsq from q) is null
          or tw.search_vector    @@ (select tsq    from q)
          or tw_en.search_vector @@ (select tsq_en from q)
          or public.immutable_unaccent(ar.name) ilike (select needle from q)
          or public.immutable_unaccent(coalesce(ti.name, i.name)) ilike (select needle from q))
     and (p_movement is null or exists (
           select 1 from artwork_movements am join movements m on m.id = am.movement_id
            where am.artwork_id = a.id and m.slug = p_movement))
     and (p_artist    is null or ar.slug = p_artist)
     and (p_country   is null or i.country_code = upper(p_country))
     and (p_year_from is null or a.year_start >= p_year_from)
     and (p_year_to   is null or a.year_start <= p_year_to)
     and (p_category  is null or a.category = p_category)
   order by score.value desc, a.notability desc, a.id
   limit max_results
$fn$;

comment on function search_artworks(text, text, text, text, text, int, int, text, int) is
  'Buscador del catálogo. Coincide por texto en el idioma pedido, por texto en inglés (red de seguridad: es el único idioma con cobertura completa), por nombre de artista y por nombre de museo.';
