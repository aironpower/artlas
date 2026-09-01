-- ============================================================================
-- Artlas · 0035 — ordenar artistas también por nacionalidad y por año
--
-- La 0034 se quedó corta: dejaba ordenar por nombre y por número de obras, y la
-- tabla tiene cuatro columnas. Una tabla en la que dos cabeceras ordenan y dos
-- no es peor que una tabla que no ordena, porque no se ve cuál es cuál hasta
-- que pulsas.
--
-- Va en migración aparte y no reescribiendo la 0034 a propósito: aquella ya
-- está aplicada en la base de verdad y `migrate` guarda su checksum. Cambiarle
-- el fichero la dejaría marcada como distinta para siempre en `--status`, que
-- es el aviso que un día servirá para detectar una migración manipulada. Un
-- fichero de más cuesta menos que un aviso que ya no significa nada.
--
-- Ordenar por año de nacimiento es lo que convierte la lista en algo que se
-- puede recorrer con criterio: el catálogo va del siglo XIII a hoy, y ver a los
-- artistas en orden cronológico es una forma de mirarlo que por nombre no
-- existe.
--
-- `nulls last` en todas: hay 1.564 artistas sin nacionalidad y 589 sin año de
-- nacimiento, y quien ordena por una columna quiere ver primero lo que TIENE
-- esa columna. Ponerlos delante llenaría la primera página de guiones.
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
     -- La lista blanca vive en el propio `order by`: un `p_sort` inventado no
     -- ordena por nada raro, cae en el desempate por id y devuelve algo
     -- estable. Interpolar el nombre de una columna que viene de una URL es
     -- cómo se regala una inyección.
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

comment on function list_artists(text, text, text, text, integer, integer) is
  'Artistas con obra, buscables y ordenables por nombre, nacionalidad, año de nacimiento o cantidad de obras. Devuelve el nombre traducido, que es el que se enseña, y el total en cada fila.';
