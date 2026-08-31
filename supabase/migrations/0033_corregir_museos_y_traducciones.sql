-- ============================================================================
-- Artlas · 0033 — corregir museos, movimientos y, sobre todo, TRADUCCIONES
--
-- Manuel encontró tres fallos mirando la app y ninguno de los tres se podía
-- arreglar con lo que había:
--
--   · el artista salía como «Jerónimo Bosch» y en español se dice «El Bosco»;
--   · el Louvre estaba en «Saint-Germain-l'Auxerrois» y no en París;
--   · el MNAC estaba en «Montjuïc» y no en Barcelona.
--
-- El primero es una TRADUCCIÓN: la app pinta `coalesce(traduccion.name, name)`,
-- así que corregir `artists.name` —lo único editable hasta hoy— no cambia nada
-- de lo que ve un visitante en español. Los otros dos son de INSTITUCIONES, una
-- tabla que no tenía ni campos editables ni forma de defenderse de la ingesta.
--
-- El de la ciudad además NO es un caso suelto, y por eso se mide antes de
-- construir: de los 30 museos con más obras, 18 tienen como ciudad un distrito,
-- un barrio o un municipio —Manhattan, Innere Stadt, City of Westminster,
-- Bezirk Mitte, «municipio de Estocolmo»—. Sale de `wdt:P131` de Wikidata, que
-- da la entidad administrativa INMEDIATA, no la ciudad. Se podría intentar
-- subir por la cadena de P131 hasta encontrar algo de clase «ciudad», pero son
-- 48 museos en total: la lista completa cabe en una pantalla y se arregla a
-- mano en un rato. Cuando sean 500, se automatiza.
--
-- Lo que añade esta migración:
--   1. `locked_fields` en instituciones, movimientos y las cuatro tablas de
--      traducción, con el mismo disparador de 0028: lo corregido a mano no lo
--      pisa la ingesta.
--   2. `editar_ficha()` para museos y movimientos, y `editar_traduccion()` para
--      los textos de cualquier entidad en cualquier idioma.
--   3. `renombrar_ciudad()`, porque «Westminster → Londres» hay que hacerlo en
--      los cuatro museos que están allí, y de uno en uno se olvida uno.
--
-- ----------------------------------------------------------------------------
-- OJO al aplicarla: toca las tablas que escribe la ingesta. `lock_timeout`
-- corto a propósito (mismo motivo que 0028): si hay un barrido vivo, esto falla
-- en tres segundos y se deshace entero, en vez de ponerse a la cola y bloquear
-- detrás de él todas las escrituras del catálogo. Si falla por el bloqueo, se
-- reintenta cuando no haya ingesta: no hay nada que arreglar.
--
-- Añadir una columna con valor por defecto constante NO reescribe la tabla
-- desde Postgres 11, así que las 163.904 filas de `artwork_translations` no se
-- copian: es un cambio de catálogo y dura milisegundos.
-- ----------------------------------------------------------------------------
-- ============================================================================

set search_path = public, extensions;
set local lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. Lo corregido a mano se defiende, también aquí
-- ----------------------------------------------------------------------------

alter table institutions add column locked_fields text[] not null default '{}';
alter table movements    add column locked_fields text[] not null default '{}';

alter table artwork_translations     add column locked_fields text[] not null default '{}';
alter table artist_translations      add column locked_fields text[] not null default '{}';
alter table institution_translations add column locked_fields text[] not null default '{}';
alter table movement_translations    add column locked_fields text[] not null default '{}';

/*
 * El disparador es el de 0028 sin tocar: trabaja sobre `to_jsonb(old/new)` y no
 * sobre una lista de columnas, así que sirve para cualquier tabla que tenga
 * `locked_fields`. Se le cuelga a las seis.
 *
 * El nombre importa en `artwork_translations`: allí ya vive
 * `artwork_translations_search_update`, y Postgres dispara por orden
 * alfabético. «r» va antes que «s», así que primero se restaura el título
 * corregido y DESPUÉS se recalcula el vector de búsqueda a partir de él. Al
 * revés, el buscador indexaría el título que la ingesta quiso poner y que
 * nunca llegó a guardarse.
 */
create trigger institutions_respetar_lo_corregido
  before update on institutions
  for each row execute function respetar_lo_corregido();

create trigger movements_respetar_lo_corregido
  before update on movements
  for each row execute function respetar_lo_corregido();

create trigger artwork_translations_respetar_lo_corregido
  before update on artwork_translations
  for each row execute function respetar_lo_corregido();

create trigger artist_translations_respetar_lo_corregido
  before update on artist_translations
  for each row execute function respetar_lo_corregido();

create trigger institution_translations_respetar_lo_corregido
  before update on institution_translations
  for each row execute function respetar_lo_corregido();

create trigger movement_translations_respetar_lo_corregido
  before update on movement_translations
  for each row execute function respetar_lo_corregido();

-- ----------------------------------------------------------------------------
-- 2. Qué se puede tocar, y en qué tabla
-- ----------------------------------------------------------------------------

/**
 * Los campos editables de cada tabla, en un solo sitio.
 *
 * Devolver NULL para una tabla desconocida es lo que hace de LISTA BLANCA: las
 * funciones de abajo reciben el nombre de la tabla desde la web, y sin esto
 * `format('%I')` dejaría escribir en cualquier tabla del esquema con solo
 * cambiar un campo oculto del formulario.
 *
 * `slug` no está y es deliberado: es la URL pública de la ficha. Renombrar un
 * museo no debe romper los enlaces que alguien haya guardado.
 * `location` tampoco: la geometría del museo está copiada en cada una de sus
 * obras (0001), así que cambiarla a mano exige mover también las obras, y eso
 * es una operación con su propia pantalla, no una casilla más de un formulario.
 */
create or replace function campos_editables(p_tabla text)
returns text[] language sql immutable as $fn$
  select case p_tabla
    when 'institutions' then array[
      'name', 'kind', 'city', 'region', 'country', 'country_code',
      'address', 'website', 'image_url', 'visitors_year', 'description']
    when 'movements' then array[
      'name', 'start_year', 'end_year', 'description']
    when 'artwork_translations'     then array['title', 'description', 'medium', 'genre']
    when 'artist_translations'      then array['name', 'description']
    when 'institution_translations' then array['name', 'description', 'city', 'country']
    when 'movement_translations'    then array['name', 'description']
    else null
  end
$fn$;

/**
 * La tabla de traducciones de cada entidad, su clave y su campo obligatorio.
 *
 * Hace falta porque una traducción que no existe hay que CREARLA antes de
 * corregirla —el Louvre tenía fila en español con nombre pero sin ciudad, y el
 * Museo Nacional de Arte Occidental no tenía fila en español siquiera—, y para
 * crearla hay que saber qué columna no admite nulos y de dónde sacar su valor.
 */
create or replace function traduccion_de(p_entidad text)
returns table (tabla text, clave text, madre text, obligatorio text)
language sql immutable as $fn$
  select t.tabla, t.clave, t.madre, t.obligatorio from (values
    ('artwork',     'artwork_translations',     'artwork_id',     'artworks',     'title'),
    ('artist',      'artist_translations',      'artist_id',      'artists',      'name'),
    ('institution', 'institution_translations', 'institution_id', 'institutions', 'name'),
    ('movement',    'movement_translations',    'movement_id',    'movements',    'name')
  ) as t(entidad, tabla, clave, madre, obligatorio)
  where t.entidad = p_entidad
$fn$;

-- ----------------------------------------------------------------------------
-- 3. Editar
-- ----------------------------------------------------------------------------

/**
 * Corrige una ficha de museo o de movimiento.
 *
 * Misma regla que 0028, que es la que gobierna todo el panel: **la persona gana
 * en el campo que ha tocado y solo en ese; Wikidata sigue mandando en el
 * resto.** Cada campo escrito a mano entra en `locked_fields` y el disparador
 * lo devuelve a su sitio pase lo que pase.
 *
 * Una sola función para las dos tablas y no `edit_institution` +
 * `edit_movement`: son idénticas salvo el nombre de la tabla, y dos copias son
 * una que se queda vieja. La lista blanca de `campos_editables()` es lo que
 * hace seguro recibir el nombre de la tabla desde fuera.
 */
create or replace function editar_ficha(
  p_tabla   text,
  p_id      bigint,
  p_cambios jsonb,
  p_soltar  text[] default '{}'
)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  editable text[] := campos_editables(p_tabla);
  campo    text;
  trozo    text;
  sets     text[] := '{}';
begin
  if not is_admin() then
    raise exception 'solo un administrador puede corregir el catálogo';
  end if;

  if p_tabla not in ('institutions', 'movements') then
    raise exception 'esta ficha no se edita así: %', p_tabla;
  end if;

  for campo in select jsonb_object_keys(p_cambios) loop
    if not (campo = any(editable)) then
      raise exception 'ese campo no se edita a mano: %', campo;
    end if;

    -- El tipo real de la columna se pregunta, no se supone (0029).
    trozo := asignacion_tipada(p_tabla::regclass, campo);
    if trozo is null then
      raise exception 'esa columna no existe en %: %', p_tabla, campo;
    end if;
    sets := sets || trozo;
  end loop;

  if cardinality(sets) = 0 and cardinality(p_soltar) = 0 then
    return;
  end if;

  -- Deja pasar el disparador: esta escritura SÍ puede tocar lo bloqueado.
  perform set_config('artlas.edicion_manual', 'si', true);

  if cardinality(sets) > 0 then
    execute format(
      'update %I set %s, locked_fields = (
         select array(select distinct unnest(locked_fields || $2))
       ) where id = $3',
      p_tabla, array_to_string(sets, ', ')
    ) using p_cambios, array(select jsonb_object_keys(p_cambios)), p_id;
  end if;

  if cardinality(p_soltar) > 0 then
    execute format(
      'update %I set locked_fields = array(
         select unnest(locked_fields) except select unnest($1)) where id = $2',
      p_tabla
    ) using p_soltar, p_id;
  end if;

  perform set_config('artlas.edicion_manual', 'no', true);
end $fn$;

/**
 * Corrige el texto de una entidad en un idioma.
 *
 * Es la pieza que faltaba para que corregir sirva de algo: la app pública
 * enseña `coalesce(traduccion, canónico)`, así que mientras solo se pudiera
 * editar lo canónico, un administrador podía guardar «El Bosco» y seguir viendo
 * «Jerónimo Bosch» en la ficha, sin ninguna pista de por qué.
 *
 * Si no hay fila en ese idioma, se crea. El campo obligatorio de la tabla
 * (`title` o `name`) se rellena con el que venga en `p_cambios` y, si no viene,
 * con el canónico de la entidad: una fila de traducción que solo trae la ciudad
 * sigue necesitando un nombre.
 */
create or replace function editar_traduccion(
  p_entidad text,
  p_id      bigint,
  p_lang    text,
  p_cambios jsonb,
  p_soltar  text[] default '{}'
)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  t        record;
  editable text[];
  campo    text;
  trozo    text;
  sets     text[] := '{}';
  existe   boolean;
begin
  if not is_admin() then
    raise exception 'solo un administrador puede corregir el catálogo';
  end if;

  select * into t from traduccion_de(p_entidad);
  if t.tabla is null then
    raise exception 'no sé traducir eso: %', p_entidad;
  end if;

  if not exists (select 1 from languages where code = p_lang) then
    raise exception 'ese idioma no existe en el catálogo: %', p_lang;
  end if;

  editable := campos_editables(t.tabla);

  for campo in select jsonb_object_keys(p_cambios) loop
    if not (campo = any(editable)) then
      raise exception 'ese campo no se edita a mano: %', campo;
    end if;

    trozo := asignacion_tipada(t.tabla::regclass, campo);
    if trozo is null then
      raise exception 'esa columna no existe en %: %', t.tabla, campo;
    end if;
    sets := sets || trozo;
  end loop;

  if cardinality(sets) = 0 and cardinality(p_soltar) = 0 then
    return;
  end if;

  perform set_config('artlas.edicion_manual', 'si', true);

  execute format('select exists (select 1 from %I where %I = $1 and lang = $2)', t.tabla, t.clave)
    into existe using p_id, p_lang;

  if not existe then
    execute format(
      'insert into %I (%I, lang, %I) values ($1, $2, coalesce($3 ->> %L, (select %I from %I where id = $1)))',
      t.tabla, t.clave, t.obligatorio, t.obligatorio, t.obligatorio, t.madre
    ) using p_id, p_lang, p_cambios;
  end if;

  if cardinality(sets) > 0 then
    execute format(
      'update %I set %s, locked_fields = (
         select array(select distinct unnest(locked_fields || $2))
       ) where %I = $3 and lang = $4',
      t.tabla, array_to_string(sets, ', '), t.clave
    ) using p_cambios, array(select jsonb_object_keys(p_cambios)), p_id, p_lang;
  end if;

  if cardinality(p_soltar) > 0 then
    execute format(
      'update %I set locked_fields = array(
         select unnest(locked_fields) except select unnest($1)) where %I = $2 and lang = $3',
      t.tabla, t.clave
    ) using p_soltar, p_id, p_lang;
  end if;

  perform set_config('artlas.edicion_manual', 'no', true);
end $fn$;

/**
 * Renombra una ciudad en todos los museos que están en ella.
 *
 * «City of Westminster» no es un museo mal puesto: son cuatro (la National
 * Gallery, la Wallace Collection, la Courtauld y la Tate Britain), y todos
 * están en Londres. Arreglarlos de uno en uno es la clase de tarea en la que se
 * queda uno a medias, y entonces el filtro de ciudad ofrece «Londres» y
 * «Ciudad de Westminster» como si fueran sitios distintos.
 *
 * `p_por_idioma` es `{"es": "Londres", "en": "London"}`. Se separa del nombre
 * canónico a propósito: el desplegable de la app enseña el traducido pero
 * FILTRA por el canónico (0032), así que son dos datos distintos y hay que
 * poder poner los dos.
 *
 * Devuelve cuántos museos ha tocado, que es lo que la pantalla necesita decir.
 */
create or replace function renombrar_ciudad(
  p_pais       text,
  p_ciudad     text,
  p_nueva      text,
  p_por_idioma jsonb default '{}'::jsonb
)
returns integer
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  museo   bigint;
  idioma  text;
  tocados integer := 0;
begin
  if not is_admin() then
    raise exception 'solo un administrador puede corregir el catálogo';
  end if;

  if coalesce(btrim(p_nueva), '') = '' then
    raise exception 'la ciudad nueva no puede estar vacía';
  end if;

  for museo in
    select id from institutions
     where city = p_ciudad
       and (p_pais is null or country_code = upper(p_pais))
  loop
    perform editar_ficha('institutions', museo, jsonb_build_object('city', btrim(p_nueva)));

    for idioma in select jsonb_object_keys(p_por_idioma) loop
      if coalesce(btrim(p_por_idioma ->> idioma), '') <> '' then
        perform editar_traduccion(
          'institution', museo, idioma,
          jsonb_build_object('city', btrim(p_por_idioma ->> idioma)));
      end if;
    end loop;

    tocados := tocados + 1;
  end loop;

  return tocados;
end $fn$;

-- ----------------------------------------------------------------------------
-- 4. Quién puede llamarlas
-- ----------------------------------------------------------------------------

revoke execute on function editar_ficha(text, bigint, jsonb, text[])              from public, anon;
revoke execute on function editar_traduccion(text, bigint, text, jsonb, text[])   from public, anon;
revoke execute on function renombrar_ciudad(text, text, text, jsonb)              from public, anon;

grant execute on function editar_ficha(text, bigint, jsonb, text[])            to authenticated;
grant execute on function editar_traduccion(text, bigint, text, jsonb, text[]) to authenticated;
grant execute on function renombrar_ciudad(text, text, text, jsonb)            to authenticated;

comment on function editar_ficha(text, bigint, jsonb, text[]) is
  'Corrige un museo o un movimiento. Lo tocado queda defendido de la ingesta.';
comment on function editar_traduccion(text, bigint, text, jsonb, text[]) is
  'Corrige el texto de una entidad en un idioma; crea la fila si no existía. La app pinta la traducción, no lo canónico.';
comment on function renombrar_ciudad(text, text, text, jsonb) is
  'Cambia la ciudad de todos los museos que la comparten: P131 de Wikidata da distritos, no ciudades.';
