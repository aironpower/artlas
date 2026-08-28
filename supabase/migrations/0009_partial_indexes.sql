-- ============================================================================
-- Artlas · 0009 — que los índices no paguen por lo que nadie consulta
--
-- Medido con `catalog_size()` sobre el catálogo real: 6.460 obras ocupan 19 MB
-- en `artworks`. Los datos de esas filas son unos 400 bytes cada una, o sea
-- ~2,6 MB: los otros 16 MB son ÍNDICES. Multiplicado por las 182.000 obras que
-- queremos amasar, la tabla sola pediría unos 535 MB y el plan gratuito son
-- 500 MB en total.
--
-- La solución no es renunciar al catálogo: es que los índices de la app cubran
-- solo lo que la app consulta. Una obra `pending` no se busca por título, ni
-- por slug, ni por año, ni sale en el mapa — no se muestra en ninguna parte.
-- Indexarla es pagar por un acceso que no existe.
--
-- Los de artista y museo SÍ se quedan completos: son btree sobre un bigint
-- (baratos) y los necesita el panel de revisión, que trabaja precisamente
-- sobre lo pendiente.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- Los caros, ahora parciales
-- ----------------------------------------------------------------------------

-- El trigrama sobre el título es con diferencia el más grande de todos: un GIN
-- guarda tres caracteres de cada posición de cada título.
drop index if exists artworks_title_trgm;
create index artworks_title_trgm on artworks
  using gin (public.immutable_unaccent(title) gin_trgm_ops)
  where status = 'published';

drop index if exists artworks_slug_idx;
create index artworks_slug_idx on artworks (slug) where status = 'published';

drop index if exists artworks_year_idx;
create index artworks_year_idx on artworks (year_start) where status = 'published';

drop index if exists artworks_category_idx;
create index artworks_category_idx on artworks (category) where status = 'published';

-- ----------------------------------------------------------------------------
-- Los que 0008 duplicó
--
-- 0008 añadió versiones parciales de estos dos sin quitar las completas, así
-- que el catálogo está pagando ambas. Se quedan solo las parciales.
-- ----------------------------------------------------------------------------
drop index if exists artworks_map_idx;         -- sustituido por artworks_published_map_idx
drop index if exists artworks_notability_idx;  -- sustituido por artworks_published_notability_idx

-- ----------------------------------------------------------------------------
-- Comprobación de imágenes incremental
--
-- La primera pasada completa dejó 3.071 de 6.460 imágenes "sin veredicto":
-- Wikimedia limita por ritmo y devolvió 429 en casi la mitad. Con 182.000
-- obras, volver a pedirlas todas cada vez es a la vez inútil y grosero — una
-- imagen que respondió ayer no ha desaparecido hoy.
--
-- Guardando cuándo se comprobó cada una, el auditor puede pedir solo las que
-- no ha visto nunca o hace mucho, e ir avanzando en pasadas cortas hasta
-- cubrirlo todo.
-- ----------------------------------------------------------------------------
alter table artworks
  add column if not exists image_checked_at timestamptz;

-- Las que faltan por comprobar, que es lo único que consulta el auditor.
create index if not exists artworks_image_check_idx
  on artworks (image_checked_at nulls first)
  where image_url is not null;

-- ----------------------------------------------------------------------------
-- Y que se pueda ver dónde se va el espacio
--
-- La versión de 0008 solo miraba tablas, y con `pg_total_relation_size` los
-- índices quedaban sumados dentro de su tabla, invisibles. Justo el dato que
-- hacía falta para tomar esta decisión.
-- ----------------------------------------------------------------------------
/*
 * OJO con el DROP: `create or replace` NO puede cambiar el tipo de retorno de
 * una función existente, y aquí se le añade la columna `tipo`. Postgres aborta
 * con "cannot change return type of existing function", y como el editor SQL
 * de Supabase envuelve el script en una transacción, eso tumba la migración
 * ENTERA en silencio: los índices parciales tampoco se aplican y todo parece
 * haber ido bien. Pasó exactamente así la primera vez.
 */
drop function if exists catalog_size();

create function catalog_size()
returns table (tipo text, objeto text, filas_aprox bigint, tamano text, bytes bigint)
language sql stable set search_path = public, extensions as $fn$
  select case c.relkind when 'r' then 'tabla' else 'indice' end,
         c.relname::text,
         c.reltuples::bigint,
         pg_size_pretty(pg_relation_size(c.oid)),
         pg_relation_size(c.oid)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'i')
   order by pg_relation_size(c.oid) desc
$fn$;

revoke execute on function catalog_size() from anon;
