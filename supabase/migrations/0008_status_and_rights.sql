-- ============================================================================
-- Artlas · 0008 — el catálogo deja de tirar obras: las guarda esperando
--
-- Medido contra Wikidata para nuestros 48 museos: existen 182.382 obras y
-- tenemos 6.161 (el 3,4%). El resto no se descartó por malas, sino por no
-- tener imagen en Commons o no llegar al umbral de notoriedad. Y no tener
-- imagen en Commons no es un defecto de la obra: para el arte del siglo XX es
-- la consecuencia de que la obra siga en derechos. El Reina Sofía tiene 1.645
-- obras y 98 imágenes; el Whitney, 2.621 y 28.
--
-- El cambio de fondo: `artworks` pasa a contener TODO lo que sabemos que
-- existe, y una columna dice si se puede enseñar.
--
--   published  se ve en la app
--   pending    existe y es real, le falta algo (imagen, derechos, coordenadas)
--   rejected   está probado que no es una obra de arte
--
-- Una sola tabla y no un almacén aparte porque la forma del dato es idéntica:
-- promover es cambiar un valor, no copiar filas; el auditor sigue viendo todo;
-- y un índice parcial deja las consultas de la app igual de rápidas con
-- 182.000 filas que con 6.000.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- Estado
-- ----------------------------------------------------------------------------
alter table artworks
  add column if not exists status text not null default 'pending'
    check (status in ('published','pending','rejected')),
  -- Por qué no está publicada. Lo rellena el clasificador y lo agrupa el panel.
  add column if not exists pending_reason text;

-- Lo que ya estaba dentro estaba visible: se queda visible. El primer pase del
-- clasificador reordenará lo que no cumpla (las 2 obras con imagen SVG, etc.).
update artworks set status = 'published' where status = 'pending';

comment on column artworks.status is
  'published = visible en la app. pending = existe pero le falta algo. rejected = no es una obra.';

/*
 * Bloqueo manual. Cuando una persona decide el estado de una obra —publicar
 * algo que el clasificador dejó pendiente, o al revés—, esto impide que la
 * siguiente pasada le lleve la contraria.
 *
 * Es la misma válvula que `ingest_rejects.admitted` en 0007, movida aquí. Sin
 * ella, corregir a mano un fallo del clasificador dura hasta la próxima
 * ingesta, y la reacción natural sería aflojar las reglas para todos.
 */
alter table artworks
  add column if not exists status_locked boolean not null default false;

/**
 * Y el bloqueo se hace cumplir en la base, no en el código que escribe.
 *
 * La ingesta guarda con un upsert que incluye `status`, así que sin esto una
 * reejecución pisaría la decisión humana sin enterarse. Un disparador lo
 * impide para cualquier escritor —la ingesta, el panel, un UPDATE a mano en el
 * editor SQL—, que es la diferencia entre una garantía y una buena intención.
 */
create or replace function keep_locked_status() returns trigger
language plpgsql set search_path = public, extensions as $fn$
begin
  if old.status_locked then
    new.status         := old.status;
    new.pending_reason := old.pending_reason;
    new.status_locked  := true;
  end if;
  return new;
end $fn$;

drop trigger if exists artworks_keep_locked_status on artworks;
create trigger artworks_keep_locked_status
  before update on artworks
  for each row execute function keep_locked_status();

/*
 * Y por eso `ingest_rejects` (0007) sobra: nació para no perder el rastro de
 * lo que la puerta no dejaba entrar, pero ahora nada se queda fuera —lo
 * rechazado se guarda con status='rejected'— así que sería un segundo registro
 * de lo mismo. Dos mecanismos para una idea acaban discrepando. Se elimina
 * estando vacía: ninguna ingesta ha corrido desde que se creó.
 */
drop table if exists ingest_rejects;

-- ----------------------------------------------------------------------------
-- Derechos
--
-- El dato no es una opinión: se deriva de la fecha de muerte del autor. En la
-- UE la obra entra en dominio público 70 años después, contados desde el 1 de
-- enero siguiente. Por eso el catálogo CRECE SOLO cada 1 de enero, y por eso
-- esto se calcula y no se escribe a mano.
--
-- `unknown` es el caso honesto y no es raro: obra anónima, o autor sin fecha
-- de muerte en Wikidata. Se trata como si estuviera en derechos, que es la
-- postura conservadora.
-- ----------------------------------------------------------------------------
alter table artworks
  add column if not exists rights_status text not null default 'unknown'
    check (rights_status in ('public_domain','in_copyright','unknown')),

  -- La declaración de derechos textual del proveedor, tal cual viene
  -- (rightsstatements.org, Creative Commons…). Es lo que hay que citar.
  add column if not exists rights_statement text,

  -- Miniatura enlazada del proveedor. NO se copia la imagen: se enlaza la que
  -- el proveedor ya sirve, que es el modelo de Europeana.
  add column if not exists thumbnail_url text,

  -- La página del proveedor a la que SIEMPRE se manda al usuario.
  add column if not exists origin_url text,

  add column if not exists europeana_id text;

create unique index if not exists artworks_europeana_idx
  on artworks (europeana_id) where europeana_id is not null;

/**
 * ¿Está en dominio público en la UE una obra cuyo autor murió ese año?
 *
 * Regla: 70 años desde el 1 de enero siguiente a la muerte. Se calcula con el
 * año actual y no con una constante, para que no haya que acordarse de
 * actualizar nada: en 2027 esta misma función libera a los muertos en 1956.
 */
create or replace function is_public_domain(death_year int)
returns boolean language sql immutable parallel safe as $fn$
  select death_year is not null
     and death_year + 70 < extract(year from current_date)::int
$fn$;

/**
 * Qué se puede enseñar de una obra según sus derechos.
 *
 *   full       la imagen completa, con zoom si la hay
 *   thumbnail  solo la miniatura del proveedor, y enlace obligado al origen
 *   none       ni eso
 *
 * Vive en SQL y no en el componente para que no haya dos criterios. Cambiar la
 * política —si un día hay dictamen legal sobre las miniaturas— es cambiar esta
 * función, no repasar la app buscando dónde se pinta una imagen.
 */
create or replace function image_mode(rights_status text, has_thumbnail boolean)
returns text language sql immutable parallel safe as $fn$
  select case
    when rights_status = 'public_domain' then 'full'
    when has_thumbnail then 'thumbnail'
    else 'none'
  end
$fn$;

-- Derechos de lo que ya está dentro, deducidos del autor.
update artworks a set rights_status = case
    when ar.death_year is null then 'unknown'
    when is_public_domain(ar.death_year) then 'public_domain'
    else 'in_copyright'
  end
  from artists ar where ar.id = a.artist_id;

-- ----------------------------------------------------------------------------
-- Índices
--
-- Parciales sobre `published`: la app nunca pregunta por lo pendiente, así que
-- sus índices no deben cargar con ello. Es lo que hace que pasar de 6.000 a
-- 182.000 filas no le cueste nada a las consultas de la web.
-- ----------------------------------------------------------------------------
create index if not exists artworks_status_idx on artworks (status);

create index if not exists artworks_published_map_idx on artworks using gist (location)
  where status = 'published' and image_url is not null;

create index if not exists artworks_published_notability_idx
  on artworks (notability desc) where status = 'published';

-- Para el panel: qué hay pendiente y por qué.
create index if not exists artworks_pending_idx
  on artworks (pending_reason) where status = 'pending';

-- ----------------------------------------------------------------------------
-- Seguridad
--
-- ESTO ES LO IMPORTANTE DE ESTA MIGRACIÓN. La política anterior era
-- `using (true)`: con las obras pendientes en la misma tabla, cualquiera con
-- la clave pública podría listarlas saltándose las funciones RPC. Se estrecha
-- a lo publicado, y así todos los caminos —RPC, PostgREST directo, el que
-- venga— enseñan lo mismo.
-- ----------------------------------------------------------------------------
drop policy if exists "catalogo publico" on artworks;
create policy "catalogo publico" on artworks
  for select using (status = 'published');

/*
 * Y por eso las funciones de lectura NO repiten el filtro. `search_artworks`,
 * `artworks_near` y `artworks_by_artist` se declararon sin SECURITY DEFINER,
 * así que se ejecutan con los permisos de quien llama y esta política las
 * alcanza. La app web usa siempre la anon key —está escrito en `lib/data.ts` y
 * es deliberado—, de modo que hay UN solo sitio donde se decide qué es
 * visible. Repetir la condición en cada función daría dos criterios que
 * mantener sincronizados, que es como se acaban desincronizando.
 *
 * La ingesta y el auditor usan service_role y ven el catálogo entero, que es
 * justo lo que necesitan.
 */

-- ----------------------------------------------------------------------------
-- Contadores: solo lo visible
--
-- Si contaran todo, el mapa diría "Nationalmuseum, 39.870 obras" y al entrar
-- habría 105. El contador es una promesa de lo que el usuario va a ver.
-- ----------------------------------------------------------------------------
create or replace function refresh_artwork_counters()
returns void language plpgsql set search_path = public, extensions as $fn$
begin
  update institutions i set artwork_count = coalesce(c.n, 0)
    from (select institution_id, count(*) n from artworks
           where institution_id is not null and status = 'published'
           group by institution_id) c
   where c.institution_id = i.id;
  -- Los museos que se quedan sin obras publicadas vuelven a cero: sin esto
  -- conservarían el contador viejo y seguirían saliendo en el mapa.
  update institutions set artwork_count = 0
   where id not in (select distinct institution_id from artworks
                     where institution_id is not null and status = 'published');

  update artists a set artwork_count = coalesce(c.n, 0)
    from (select artist_id, count(*) n from artworks
           where artist_id is not null and status = 'published'
           group by artist_id) c
   where c.artist_id = a.id;
  update artists set artwork_count = 0
   where id not in (select distinct artist_id from artworks
                     where artist_id is not null and status = 'published');

  update movements m set artwork_count = coalesce(c.n, 0)
    from (select am.movement_id, count(*) n
            from artwork_movements am join artworks a on a.id = am.artwork_id
           where a.status = 'published' group by am.movement_id) c
   where c.movement_id = m.id;
  update movements set artwork_count = 0
   where id not in (select distinct am.movement_id
                      from artwork_movements am join artworks a on a.id = am.artwork_id
                     where a.status = 'published');
end $fn$;

-- ----------------------------------------------------------------------------
-- Tamaño del catálogo, para no navegar a ciegas con el plan gratuito
--
-- 500 MB es el límite, y la pregunta "¿cuánto ocupa cada cosa?" no se puede
-- responder desde PostgREST. Esto la responde. Se le quita el permiso a la
-- clave pública: no es un secreto, pero tampoco es asunto del navegador.
-- ----------------------------------------------------------------------------
create or replace function catalog_size()
returns table (objeto text, filas_aprox bigint, tamano text, bytes bigint)
language sql stable set search_path = public, extensions as $fn$
  select c.relname::text,
         c.reltuples::bigint,
         pg_size_pretty(pg_total_relation_size(c.oid)),
         pg_total_relation_size(c.oid)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by pg_total_relation_size(c.oid) desc
$fn$;

revoke execute on function catalog_size() from anon;
