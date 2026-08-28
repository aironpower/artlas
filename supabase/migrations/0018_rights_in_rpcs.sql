-- ============================================================================
-- Artlas · 0018 — los derechos llegan a la interfaz
--
-- Dos cosas:
--
-- A) `image_mode()` tenía un fallo que solo se vio al medirlo contra el
--    catálogo. Comparaba el principio de la URL con 'https://commons...', pero
--    60.821 de las 61.848 imágenes están guardadas con 'http://'. Esas caían a
--    la rama de derechos, y 4.394 obras se habrían quedado sin imagen pese a
--    estar alojadas en Commons: American Gothic, la Dama de Elche, la Estela
--    de los Buitres. Ahora se compara el SERVIDOR, que no depende del esquema.
--
-- B) Las funciones de lectura no devolvían nada sobre derechos, así que la web
--    no podía aplicar la política aunque estuviera decidida en SQL. Se les
--    añaden cuatro columnas, `image_mode` entre ellas, para que la interfaz
--    obedezca en vez de decidir.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- A) La política, corregida
-- ----------------------------------------------------------------------------
drop function if exists image_mode(text, text, text);

/**
 * Qué se puede enseñar de una obra: 'full' | 'thumbnail' | 'none'.
 *
 * El orden de las reglas es el orden de autoridad de las fuentes:
 *
 * 1. Quién aloja el fichero. Wikimedia Commons no admite contenido con
 *    derechos, y el Met solo sirve imágenes en `images.metmuseum.org` para su
 *    Open Access. En los dos casos es una afirmación de quien lo publica, no
 *    una deducción nuestra sobre la fecha de muerte del autor.
 *
 *    Esta lista es una decisión de DERECHOS, no técnica: añadir un servidor
 *    aquí es afirmar que lo que sirve se puede mostrar. No añadir hosts a la
 *    ligera.
 *
 * 2. La obra está en dominio público (P6216 o la regla de los 70 años).
 * 3. Hay miniatura del proveedor: se enseña solo esa, con enlace al origen.
 * 4. Si no, ficha sin imagen.
 */
create function image_mode(
  rights_status text,
  image_url     text,
  thumbnail_url text
)
returns text language sql immutable parallel safe as $fn$
  select case
    when split_part(split_part(image_url, '//', 2), '/', 1) in (
           'commons.wikimedia.org',
           'upload.wikimedia.org',
           'images.metmuseum.org'
         ) then 'full'
    when rights_status = 'public_domain' and image_url is not null then 'full'
    when thumbnail_url is not null then 'thumbnail'
    else 'none'
  end
$fn$;

-- ----------------------------------------------------------------------------
-- B) Las funciones de lectura devuelven los derechos
--
-- Cambia el tipo de retorno, así que hay que soltarlas primero: `create or
-- replace` aborta con "cannot change return type" y, dentro de una
-- transacción, tumba la migración entera en silencio.
--
-- Y al recrearlas hay que devolverles el SECURITY DEFINER de 0014 y sus
-- permisos: sin eso, RLS vuelve a impedir el uso del índice geográfico y
-- "cerca de mí" pasa otra vez de 0,6 a 8 segundos.
-- ----------------------------------------------------------------------------

drop function if exists artworks_near(double precision, double precision, text, int, text, int);

create function artworks_near(
  lat           double precision,
  lng           double precision,
  p_lang        text default 'es',
  radius_m      int  default 5000,
  movement_slug text default null,
  max_results   int  default 100
)
returns table (
  id bigint, title text, slug text, image_url text, year_start int, date_display text,
  artist_name text, institution_name text, institution_slug text,
  distance_m double precision,
  rights_status text, thumbnail_url text, origin_url text, image_mode text
)
language sql stable security definer set search_path = public, extensions as $fn$
  select a.id,
         coalesce(tw.title, tw_en.title, a.title),
         a.slug, a.image_url, a.year_start, a.date_display,
         coalesce(ta.name, ar.name),
         coalesce(ti.name, i.name),
         i.slug,
         st_distance(a.location, st_makepoint(lng, lat)::geography),
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
     and a.image_url is not null
     and st_dwithin(a.location, st_makepoint(lng, lat)::geography, radius_m)
     and (movement_slug is null or exists (
           select 1 from artwork_movements am
             join movements m on m.id = am.movement_id
            where am.artwork_id = a.id and m.slug = movement_slug))
   order by a.notability desc,
            st_distance(a.location, st_makepoint(lng, lat)::geography) asc
   limit max_results
$fn$;

grant execute on function artworks_near(double precision, double precision, text, int, text, int)
  to anon, authenticated;

drop function if exists artworks_by_artist(text, text, int);

create function artworks_by_artist(
  p_slug      text,
  p_lang      text default 'es',
  max_results int  default 500
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
   limit max_results
$fn$;

grant execute on function artworks_by_artist(text, text, int) to anon, authenticated;
