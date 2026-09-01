-- ============================================================================
-- Artlas · 0036 — filtrar artistas por nacionalidad y por época
--
-- Pedido por Manuel: «estaría bien filtrar autor por nacionalidad o fecha».
-- Con 11.426 artistas, ordenar y buscar por nombre no basta: para llegar a los
-- pintores holandeses del XVII hay que poder decirlo, no ir pasando páginas.
--
-- Dos añadidos a `list_artists`:
--
--   · `p_nat`, exacta y no por texto libre. La nacionalidad sale de Wikidata
--     como una etiqueta cerrada —«Dutch Republic», «Kingdom of Pergamon»— y son
--     220 distintas: se eligen de una lista, así que comparar por igualdad es
--     lo correcto y además usa el índice. Un `ilike` aquí haría que «Netherlands»
--     arrastrara «Southern Netherlands», que es otro sitio y otro siglo.
--
--   · `p_desde` y `p_hasta` sobre el AÑO DE NACIMIENTO, no sobre el de muerte
--     ni sobre un solapamiento de vidas. Es lo que se entiende por «un artista
--     del XVII» y lo que se puede explicar en una etiqueta de formulario. El
--     catálogo va de -1809 a 2006, así que el rango tiene que admitir negativos.
--
-- Un artista sin año de nacimiento —589 de 11.426— desaparece en cuanto se pide
-- un rango, y es lo correcto: si preguntas por los nacidos entre 1600 y 1700, de
-- quien no se sabe cuándo nació no se puede afirmar que esté dentro.
--
-- Y `list_nationalities`, que da la lista para el desplegable con su recuento.
-- Va como función y no como consulta de PostgREST porque es un `group by`, y
-- porque el recuento tiene que respetar el mismo filtro de `artwork_count > 0`
-- que la tabla: ofrecer «Suecia (783)» y que luego salgan 12 sería mentir en la
-- propia etiqueta del filtro.
-- ============================================================================

set search_path = public, extensions;

/*
 * Primero se tira la de 0034/0035, y no es limpieza opcional.
 *
 * Postgres identifica una función por sus argumentos, así que un `create or
 * replace` con tres parámetros más NO reemplaza nada: crea una segunda función
 * con el mismo nombre. Quedarían las dos, y una llamada con seis argumentos
 * seguiría cayendo en la vieja —la que no sabe filtrar— sin dar ningún error.
 * Eso es exactamente la clase de fallo que no se ve: el filtro parecería no
 * hacer nada según por dónde entrara la llamada.
 */
drop function if exists list_artists(text, text, text, text, integer, integer);

create or replace function list_artists(
  p_lang   text    default 'es',
  p_q      text    default null,
  p_sort   text    default 'works',
  p_dir    text    default 'desc',
  p_limit  integer default 60,
  p_offset integer default 0,
  p_nat    text    default null,
  p_desde  integer default null,
  p_hasta  integer default null
)
returns table (
  slug          text,
  name          text,
  nationality   text,
  birth_year    integer,
  death_year    integer,
  artwork_count integer,
  total         bigint
)
language sql stable security definer set search_path = public, extensions as $fn$
  with visibles as (
    select a.id,
           a.slug,
           coalesce(t.name, a.name) as nombre,
           a.nationality,
           a.birth_year,
           a.death_year,
           a.artwork_count
      from artists a
      left join artist_translations t
        on t.artist_id = a.id and t.lang = p_lang
     where a.artwork_count > 0
       and (p_nat   is null or a.nationality = p_nat)
       and (p_desde is null or a.birth_year >= p_desde)
       and (p_hasta is null or a.birth_year <= p_hasta)
  ),
  filtrados as (
    select * from visibles
     where coalesce(btrim(p_q), '') = ''
        or immutable_unaccent(nombre) ilike immutable_unaccent('%' || btrim(p_q) || '%')
  )
  select f.slug,
         f.nombre,
         f.nationality,
         f.birth_year,
         f.death_year,
         f.artwork_count,
         count(*) over () as total
    from filtrados f
   order by
     -- La lista blanca vive en el propio `order by`: un `p_sort` inventado cae
     -- en el desempate por id en vez de ordenar por algo raro. Interpolar el
     -- nombre de una columna que viene de una URL es regalar una inyección.
     case when p_sort = 'name'  and p_dir = 'asc'  then immutable_unaccent(f.nombre) end asc  nulls last,
     case when p_sort = 'name'  and p_dir = 'desc' then immutable_unaccent(f.nombre) end desc nulls last,
     case when p_sort = 'nat'   and p_dir = 'asc'  then f.nationality   end asc  nulls last,
     case when p_sort = 'nat'   and p_dir = 'desc' then f.nationality   end desc nulls last,
     case when p_sort = 'anios' and p_dir = 'asc'  then f.birth_year    end asc  nulls last,
     case when p_sort = 'anios' and p_dir = 'desc' then f.birth_year    end desc nulls last,
     case when p_sort = 'works' and p_dir = 'asc'  then f.artwork_count end asc  nulls last,
     case when p_sort = 'works' and p_dir = 'desc' then f.artwork_count end desc nulls last,
     f.id
   limit  greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

/**
 * Las nacionalidades que hay, con cuántos artistas tiene cada una.
 *
 * Ordenadas por número y no alfabéticamente: en un desplegable de 220, lo que
 * alguien busca casi siempre está entre las diez primeras, y las 81 que tienen
 * un solo artista no merecen encabezar la lista.
 */
create or replace function list_nationalities()
returns table (nationality text, artists bigint)
language sql stable security definer set search_path = public, extensions as $fn$
  select a.nationality, count(*) as artists
    from artists a
   where a.artwork_count > 0 and a.nationality is not null
   group by a.nationality
   order by count(*) desc, a.nationality;
$fn$;

revoke execute on function list_artists(text, text, text, text, integer, integer, text, integer, integer) from public;
grant  execute on function list_artists(text, text, text, text, integer, integer, text, integer, integer) to anon, authenticated;

revoke execute on function list_nationalities() from public;
grant  execute on function list_nationalities() to anon, authenticated;

comment on function list_nationalities() is
  'Nacionalidades del catálogo con su recuento, para el desplegable del filtro. Ordenadas por número de artistas.';
