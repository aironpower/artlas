-- ============================================================================
-- Artlas · 0025 — paginar hondo sin pagar por lo que se descarta
--
-- La 0023 dejó las listas paginadas, y en producción la PRIMERA visita a una
-- página profunda devolvía 500: la 100 del Prado tardó 3,9 s contra el
-- statement_timeout de 3 s del rol `anon`. Caliente iba a 1 s, así que solo lo
-- sufría el primero en llegar, que es justo a quien no se puede servir un error.
--
-- La causa es cómo se escribió el `offset`: para la página 111, Postgres
-- construye las 3.990 filas CON sus cinco joins de traducción y tira 3.960. Se
-- paga el museo entero para enseñar 36 obras.
--
-- Aquí se hace en dos pasos: primero solo los identificadores, que salen del
-- índice de 0024 sin tocar ninguna tabla más, y los joins después, para las 36
-- filas que se van a enseñar. Medido sobre la página 111, cinco pasadas:
--
--   como estaba   mediana 62 ms · peor 107 ms · 319.670 bloques
--   en dos pasos  mediana  4 ms · peor  16 ms ·  23.987 bloques
--
-- Los bloques son la cifra que importa: no dependen de si la caché está
-- caliente, y son el trabajo que la primera visita tiene que pagar.
--
-- El slug se resuelve a id en un subselect en vez de con un join, para que la
-- condición nombre `institution_id` y el índice parcial de 0024 pueda usarse.
-- La firma y el tipo de retorno no cambian, así que basta `create or replace`.
-- ============================================================================

create or replace function artworks_by_institution(
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
  with pagina as (
    select a.id, a.notability, a.year_start
      from artworks a
     where a.institution_id = (select i.id from institutions i where i.slug = p_slug)
       and a.status = 'published'
     order by a.notability desc, a.year_start asc nulls last, a.id
     limit max_results offset p_offset
  )
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display, a.category,
         coalesce(ta.name, ar.name),
         ar.slug,
         a.notability,
         a.rights_status, a.thumbnail_url, a.origin_url,
         image_mode(a.rights_status, a.image_url, a.thumbnail_url)
    from pagina p
    join artworks a on a.id = p.id
    left join artists ar on ar.id = a.artist_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join artist_translations ta     on ta.artist_id = ar.id and ta.lang = p_lang
   order by p.notability desc, p.year_start asc nulls last, a.id
$fn$;

-- Lo mismo para las obras de un artista. Aquí las listas son más cortas —el
-- que más tiene es Rubens, con 612— pero el motivo para escribirlo igual no es
-- el tamaño de hoy: es que haya UNA forma de paginar en el proyecto y no dos
-- que se comporten distinto el día que un artista pase de mil obras.

create or replace function artworks_by_artist(
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
  with pagina as (
    select a.id, a.notability, a.year_start
      from artworks a
     where a.artist_id = (select ar.id from artists ar where ar.slug = p_slug)
       and a.status = 'published'
     order by a.notability desc, a.year_start asc nulls last, a.id
     limit max_results offset p_offset
  )
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
    from pagina p
    join artworks a on a.id = p.id
    left join institutions i on i.id = a.institution_id
    left join artwork_translations tw    on tw.artwork_id = a.id and tw.lang = p_lang
    left join artwork_translations tw_en on tw_en.artwork_id = a.id and tw_en.lang = 'en'
    left join institution_translations ti
      on ti.institution_id = i.id and ti.lang = p_lang
   order by p.notability desc, p.year_start asc nulls last, a.id
$fn$;

-- El índice que la rama de artista necesita, hermano del de 0024. El que había
-- (`artworks_artist_idx`) es solo sobre `artist_id`: encuentra las obras pero
-- no las trae ordenadas, así que la página profunda volvía a ordenar de cero.
create index if not exists artworks_artist_order_idx
  on artworks (artist_id, notability desc, year_start, id)
  where status = 'published';
