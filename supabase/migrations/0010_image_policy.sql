-- ============================================================================
-- Artlas · 0010 — qué imagen se puede enseñar, y por qué
--
-- 0008 decidía con un solo dato: si la obra estaba en dominio público. Con eso,
-- 49 obras del catálogo quedaban sin imagen — Hopper, Warhol, Lichtenstein,
-- Chagall, Dalí— y las 49 tienen su fichero alojado en Wikimedia Commons, que
-- por política solo admite contenido libre.
--
-- El error era mezclar dos cosas distintas:
--
--   · los derechos de la OBRA      -> cuándo murió el autor, qué dice P6216
--   · la licencia del FICHERO      -> quién lo aloja y bajo qué condiciones
--
-- Lo que decide si podemos pintar un <img> es lo segundo. Que Commons aloje un
-- fichero es una afirmación explícita de su comunidad de que ese fichero es
-- libre; contradecirla con una deducción nuestra sobre la fecha de muerte del
-- autor es ponernos por encima de la fuente sin datos para hacerlo.
-- ============================================================================

set search_path = public, extensions;

/*
 * OJO: cambia la firma (antes recibía un boolean), así que hay que soltarla
 * primero. `create or replace` aborta con "cannot change return type" y, en el
 * editor SQL de Supabase, eso tumba la migración entera en silencio.
 */
drop function if exists image_mode(text, boolean);

/**
 * Qué se puede enseñar de una obra.
 *
 *   full       la imagen completa
 *   thumbnail  solo la miniatura del proveedor, con enlace obligado al origen
 *   none       ni eso: ficha sin imagen
 *
 * El orden de las reglas es el orden de autoridad de las fuentes:
 *
 * 1. El fichero está en Wikimedia Commons. Commons no aloja contenido con
 *    derechos: si está ahí, es libre, y lo dice quien lo aloja.
 * 2. La obra está en dominio público, según lo que declara Wikidata (P6216) o,
 *    en su defecto, la regla de los 70 años.
 * 3. Hay miniatura del proveedor (Europeana y similares): se enseña solo esa,
 *    y la ficha obliga a enlazar al origen. Es el modelo de europeana.eu.
 * 4. Si no, no hay imagen que enseñar.
 *
 * Vive en SQL y no en el componente para que exista UN criterio. El día que
 * haya dictamen legal sobre las miniaturas, se cambia esta función y no hay
 * que repasar la app buscando dónde se pinta una imagen.
 */
create function image_mode(
  rights_status text,
  image_url     text,
  thumbnail_url text
)
returns text language sql immutable parallel safe as $fn$
  select case
    when image_url like 'https://commons.wikimedia.org/%' then 'full'
    when image_url like 'https://upload.wikimedia.org/%'  then 'full'
    when rights_status = 'public_domain' and image_url is not null then 'full'
    when thumbnail_url is not null then 'thumbnail'
    else 'none'
  end
$fn$;

comment on function image_mode(text, text, text) is
  'Política de imagen: full | thumbnail | none. Único criterio de la app; la interfaz no decide.';
