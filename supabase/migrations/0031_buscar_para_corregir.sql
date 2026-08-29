-- ============================================================================
-- Artlas · 0031 — buscar lo que hay que corregir, sin agotar el tiempo
--
-- La pantalla de corregir buscaba con `title ilike '%…%'` desde la web, y eso
-- estaba mal de dos maneras a la vez:
--
-- 1. **Tardaba 25-34 s.** El índice `artworks_title_trgm` no le servía: está
--    sobre `immutable_unaccent(title)` —así que un `ilike` a pelo no lo usa— y
--    además es **parcial, solo para obras publicadas**, que son justamente las
--    que menos falta hace corregir. El plan era un escaneo secuencial.
-- 2. **Fallaba en silencio.** El rol `anon`/`authenticated` corta a los 3 s, y
--    la web recibía `data: null` y pintaba «Nada encontrado». Decirle a alguien
--    que su obra no existe cuando lo que ha pasado es que la consulta se ha
--    caído es la clase de mentira que hace perder una tarde.
--
-- Esta función busca por los tres caminos reales —número de ficha, QID y
-- título— y todos van por índice.
--
-- **Límite conocido, y dicho en voz alta**: el título se busca en
-- `artwork_translations`, que sí tiene índice completo. Las obras que esperan
-- datos se guardan SIN traducciones para ahorrar espacio (130 de 71.244 las
-- tienen), así que por título no se llega a ellas: se llega por su número o su
-- QID. Se arregla cambiando el índice parcial de `artworks` —que nunca se ha
-- usado, `idx_scan = 0`— por uno completo, y eso se hace cuando no haya una
-- ingesta escribiendo, porque construirlo la frenaría.
--
-- Solo crea una función: se puede aplicar con una ingesta viva.
-- ============================================================================

set search_path = public, extensions;

/**
 * Busca obras para corregirlas.
 *
 * `security definer` para poder mirar el catálogo entero, y con la comprobación
 * de rol dentro: sin ella sería una forma de leer las obras no publicadas sin
 * ser administrador.
 */
create or replace function admin_search_artworks(p_q text, p_limite integer default 25)
returns table (
  id bigint, title text, status text, wikidata_qid text,
  locked_fields text[], status_locked boolean, artist_name text
)
language plpgsql stable security definer set search_path = public, extensions as $fn$
declare
  q text := btrim(coalesce(p_q, ''));
begin
  if not is_admin() then
    raise exception 'solo un administrador puede buscar en todo el catálogo';
  end if;

  if q = '' then return; end if;

  return query
  select a.id, a.title, a.status, a.wikidata_qid,
         a.locked_fields, a.status_locked, ar.name
    from artworks a
    left join artists ar on ar.id = a.artist_id
   where
     -- Por número de ficha
     (q ~ '^[0-9]+$' and a.id = q::bigint)
     -- Por identificador de Wikidata
     or (q ~* '^Q[0-9]+$' and a.wikidata_qid = upper(q))
     -- Por título, a través del índice de traducciones
     or (q !~ '^[0-9]+$' and q !~* '^Q[0-9]+$' and exists (
           select 1 from artwork_translations t
            where t.artwork_id = a.id
              and immutable_unaccent(t.title) ilike immutable_unaccent('%' || q || '%')
         ))
   order by a.notability desc, a.id
   limit greatest(1, least(p_limite, 100));
end $fn$;

/** Lo mismo para artistas, que sí tienen todos su traducción. */
create or replace function admin_search_artists(p_q text, p_limite integer default 15)
returns table (
  id bigint, name text, slug text, artwork_count integer,
  wikidata_qid text, locked_fields text[]
)
language plpgsql stable security definer set search_path = public, extensions as $fn$
declare
  q text := btrim(coalesce(p_q, ''));
begin
  if not is_admin() then
    raise exception 'solo un administrador puede buscar en todo el catálogo';
  end if;

  if q = '' then return; end if;

  return query
  select a.id, a.name, a.slug, a.artwork_count, a.wikidata_qid, a.locked_fields
    from artists a
   where (q ~ '^[0-9]+$' and a.id = q::bigint)
      or (q ~* '^Q[0-9]+$' and a.wikidata_qid = upper(q))
      or (q !~ '^[0-9]+$' and q !~* '^Q[0-9]+$'
          and immutable_unaccent(a.name) ilike immutable_unaccent('%' || q || '%'))
   order by a.artwork_count desc nulls last, a.id
   limit greatest(1, least(p_limite, 100));
end $fn$;

revoke execute on function admin_search_artworks(text, integer) from public, anon;
revoke execute on function admin_search_artists(text, integer)  from public, anon;
grant  execute on function admin_search_artworks(text, integer) to authenticated;
grant  execute on function admin_search_artists(text, integer)  to authenticated;

comment on function admin_search_artworks(text, integer) is
  'Busca por número, QID o título (vía traducciones). Las obras pendientes sin traducción solo por número o QID.';
