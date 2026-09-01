-- ============================================================================
-- Artlas · 0034 — listar y buscar artistas desde la web pública
--
-- Manuel: «el buscador sirve para buscar obras pero no para buscar artistas».
-- Es literal: `search_artworks` busca obras, y la única función que encuentra
-- artistas es `admin_search_artists` (0031), revocada a `anon` porque sirve
-- para corregir el catálogo. Un visitante no tenía forma de llegar a un artista
-- que no estuviera entre los más prolíficos.
--
-- Lo que resuelve esta función, y por qué no se hace desde la app:
--
--   1. **El nombre que se enseña no es el de la tabla.** La app pinta
--      `coalesce(traducción, canónico)` —«El Bosco», no «Hieronymus Bosch»—, y
--      buscar o alfabetizar por el canónico daría resultados distintos de los
--      que se leen en pantalla. Con `artist_translations` de por medio, eso es
--      un `left join` que PostgREST no sabe ordenar ni filtrar.
--
--   2. **Ordenar y paginar a la vez.** La tabla se puede ordenar por nombre o
--      por número de obras, en los dos sentidos, y hay que paginar el resultado
--      sin traerse 11.426 filas por la red.
--
--   3. **El total, en la misma consulta.** Va como columna con `count(*) over
--      ()`: una segunda consulta solo para saber cuántas páginas hay es pagar
--      dos veces por el mismo filtro.
--
-- Medido antes de escribirla, sobre los 11.426 artistas con obra: ordenar por
-- nombre 314 ms, buscar «goya» 59 ms, contar el filtrado 48 ms. Muy por debajo
-- de los 3 s del rol, así que no hace falta índice nuevo: el trigram sobre
-- `immutable_unaccent(name)` de 0001 ya cubre la búsqueda.
--
-- `p_sort` y `p_dir` NO se interpolan en SQL. Son una lista blanca resuelta con
-- `case` en el `order by`: recibir el nombre de una columna desde una URL y
-- meterlo en un `execute format` es cómo se regala una inyección.
-- ============================================================================

set search_path = public, extensions;

create or replace function list_artists(
  p_lang   text    default 'es',
  p_q      text    default null,
  p_sort   text    default 'works',
  p_dir    text    default 'desc',
  p_limit  integer default 60,
  p_offset integer default 0
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
     -- Cuatro `case` y no un `format`: la lista blanca vive en el propio
     -- `order by`, así que un `p_sort` inventado no ordena por nada raro, cae
     -- en el desempate por id y devuelve algo estable.
     case when p_sort = 'name'  and p_dir = 'asc'  then immutable_unaccent(f.nombre) end asc  nulls last,
     case when p_sort = 'name'  and p_dir = 'desc' then immutable_unaccent(f.nombre) end desc nulls last,
     case when p_sort = 'works' and p_dir = 'asc'  then f.artwork_count end asc  nulls last,
     case when p_sort = 'works' and p_dir = 'desc' then f.artwork_count end desc nulls last,
     f.id
   limit  greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

revoke execute on function list_artists(text, text, text, text, integer, integer) from public;
grant  execute on function list_artists(text, text, text, text, integer, integer) to anon, authenticated;

comment on function list_artists(text, text, text, text, integer, integer) is
  'Artistas con obra, buscables y ordenables por nombre o cantidad. Devuelve el nombre traducido, que es el que se enseña, y el total en cada fila.';
