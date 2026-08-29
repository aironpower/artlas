-- ============================================================================
-- Artlas · 0028 — corregir el catálogo a mano, y que Wikidata no lo pise
--
-- Falta la última mitad de lo que Manuel pidió: crear y corregir obras y
-- artistas desde la web. Escribir el formulario es lo fácil; lo que hay que
-- decidir antes es qué pasa la próxima vez que la ingesta pase por encima.
--
-- **La regla, escrita para que no haya que adivinarla:** la persona gana en el
-- campo que ha tocado, y solo en ese. Wikidata gana en todo lo demás.
--
-- No es un término medio cobarde, es lo único sostenible: son 148.000 obras y
-- nadie va a mantenerlas a mano, así que la fuente tiene que seguir mandando
-- por defecto. Pero una corrección hecha a conciencia —un título con la coletilla
-- «(Goya)» quitada, una fecha arreglada— no puede deshacerse sola en el
-- siguiente barrido: eso convierte los formularios en trabajo que se tira.
--
-- **Dónde vive la garantía: en un disparador, no en la ingesta.** Podría
-- resolverse leyendo `locked_fields` antes de cada upsert, pero entonces la
-- regla dependería de que todo el que escriba se acuerde. Aquí la base restaura
-- el valor corregido pase lo que pase, venga de la ingesta, de un script suelto
-- o de algo que aún no existe.
--
-- ----------------------------------------------------------------------------
-- OJO al aplicarla: toca `artworks` y `artists`, que es lo único que la ingesta
-- escribe sin parar. `lock_timeout` corto a propósito: si hay un barrido vivo,
-- esta migración falla en tres segundos y se deshace entera, en vez de ponerse
-- a la cola y bloquear detrás de ella todas las escrituras del catálogo. Eso
-- último ya tumbó un museo entero el 28 de agosto de 2026. Si falla por el
-- bloqueo, se reintenta cuando no haya ingesta: no hay nada que arreglar.
-- ----------------------------------------------------------------------------
-- ============================================================================

set search_path = public, extensions;
set local lock_timeout = '3s';

alter table artworks add column locked_fields text[] not null default '{}';
alter table artists  add column locked_fields text[] not null default '{}';

comment on column artworks.locked_fields is
  'Campos corregidos a mano. La ingesta no los pisa: lo impide el disparador respetar_lo_corregido().';

-- ----------------------------------------------------------------------------
-- El disparador
-- ----------------------------------------------------------------------------

/**
 * Devuelve a su sitio los campos que alguien corrigió a mano.
 *
 * Trabaja sobre `to_jsonb(old/new)` en vez de con una lista de columnas escrita
 * a mano, y es deliberado: una lista habría que actualizarla cada vez que la
 * tabla crece, y el día que a alguien se le olvide el fallo es silencioso —la
 * corrección desaparece y nadie se entera hasta que la busca—.
 *
 * La excepción: una edición hecha a mano SÍ puede cambiar un campo bloqueado
 * —si no, no se podría corregir dos veces—. Se distingue con un ajuste de
 * sesión que solo ponen las funciones de edición de más abajo. La ingesta
 * escribe por PostgREST y nunca lo pone, así que queda protegida sin saberlo.
 */
create or replace function respetar_lo_corregido()
returns trigger
language plpgsql set search_path = public, extensions as $fn$
declare
  fila jsonb;
begin
  if coalesce(current_setting('artlas.edicion_manual', true), '') = 'si' then
    return new;
  end if;

  if old.locked_fields is null or cardinality(old.locked_fields) = 0 then
    return new;
  end if;

  fila := to_jsonb(new) || (
    select jsonb_object_agg(campo, to_jsonb(old) -> campo)
      from unnest(old.locked_fields) as campo
  );

  -- La lista de lo bloqueado también es cosa de quien edita a mano.
  fila := jsonb_set(fila, '{locked_fields}', to_jsonb(old.locked_fields));

  return jsonb_populate_record(new, fila);
end $fn$;

create trigger artworks_respetar_lo_corregido
  before update on artworks
  for each row execute function respetar_lo_corregido();

create trigger artists_respetar_lo_corregido
  before update on artists
  for each row execute function respetar_lo_corregido();

-- ----------------------------------------------------------------------------
-- Editar
-- ----------------------------------------------------------------------------

/*
 * Se edita con funciones y no con políticas de UPDATE, por el motivo que ya
 * quedó escrito en 0022: una política no puede impedir que se cambien OTRAS
 * columnas de la misma fila, y comparar cada columna con su valor anterior
 * dentro de la política es ilegible y fácil de dejar incompleto al añadir una
 * columna nueva. Aquí la lista de lo editable está en un sitio y se ve entera.
 */

/** Los campos de una obra que una persona puede tocar. */
create or replace function campos_editables_obra()
returns text[] language sql immutable as $fn$
  select array[
    'title', 'title_es', 'year_start', 'year_end', 'date_display',
    'category', 'medium', 'genre', 'height_cm', 'width_cm',
    'image_url', 'source_url', 'description', 'status', 'rights_status'
  ]
$fn$;

/** Los de un artista. */
create or replace function campos_editables_artista()
returns text[] language sql immutable as $fn$
  select array['name', 'birth_year', 'death_year', 'nationality', 'bio']
$fn$;

/**
 * Corrige una obra.
 *
 * `p_cambios` es un objeto con los campos a cambiar. Cada campo que se toca
 * queda bloqueado: haberlo escrito a mano ES la señal de que se quiere
 * defender. No hay una casilla aparte de «proteger esto» porque nadie corrige
 * un dato para que se lo deshagan mañana, y una casilla que siempre se marca es
 * una casilla que sobra.
 *
 * Para soltar un campo y que Wikidata vuelva a mandar, `p_soltar`.
 */
create or replace function edit_artwork(
  p_id      bigint,
  p_cambios jsonb,
  p_soltar  text[] default '{}'
)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  campo    text;
  editable text[] := campos_editables_obra();
  sets     text[] := '{}';
begin
  if not is_admin() then
    raise exception 'solo un administrador puede corregir el catálogo';
  end if;

  for campo in select jsonb_object_keys(p_cambios) loop
    if not (campo = any(editable)) then
      raise exception 'ese campo no se edita a mano: %', campo;
    end if;
    sets := sets || format('%I = ($1 ->> %L)::text', campo, campo);
  end loop;

  if cardinality(sets) = 0 and cardinality(p_soltar) = 0 then
    return;
  end if;

  -- Deja pasar el disparador: esta escritura SÍ puede tocar lo bloqueado.
  perform set_config('artlas.edicion_manual', 'si', true);

  /*
   * Un solo UPDATE dinámico con los campos que vengan. El `%I` de `format`
   * escapa el nombre de columna, y los valores viajan como parámetro: nada de
   * lo que llega del formulario se concatena en el SQL.
   */
  if cardinality(sets) > 0 then
    execute format(
      'update artworks set %s, locked_fields = (
         select array(select distinct unnest(locked_fields || $2))
       ) where id = $3',
      array_to_string(sets, ', ')
    ) using p_cambios, array(select jsonb_object_keys(p_cambios)), p_id;
  end if;

  if cardinality(p_soltar) > 0 then
    update artworks
       set locked_fields = array(
             select unnest(locked_fields) except select unnest(p_soltar))
     where id = p_id;
  end if;

  perform set_config('artlas.edicion_manual', 'no', true);
end $fn$;

/** Lo mismo para un artista. */
create or replace function edit_artist(
  p_id      bigint,
  p_cambios jsonb,
  p_soltar  text[] default '{}'
)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  campo    text;
  editable text[] := campos_editables_artista();
  sets     text[] := '{}';
begin
  if not is_admin() then
    raise exception 'solo un administrador puede corregir el catálogo';
  end if;

  for campo in select jsonb_object_keys(p_cambios) loop
    if not (campo = any(editable)) then
      raise exception 'ese campo no se edita a mano: %', campo;
    end if;
    sets := sets || format('%I = ($1 ->> %L)::text', campo, campo);
  end loop;

  if cardinality(sets) = 0 and cardinality(p_soltar) = 0 then
    return;
  end if;

  perform set_config('artlas.edicion_manual', 'si', true);

  if cardinality(sets) > 0 then
    execute format(
      'update artists set %s, locked_fields = (
         select array(select distinct unnest(locked_fields || $2))
       ) where id = $3',
      array_to_string(sets, ', ')
    ) using p_cambios, array(select jsonb_object_keys(p_cambios)), p_id;
  end if;

  if cardinality(p_soltar) > 0 then
    update artists
       set locked_fields = array(
             select unnest(locked_fields) except select unnest(p_soltar))
     where id = p_id;
  end if;

  perform set_config('artlas.edicion_manual', 'no', true);
end $fn$;

/**
 * Crea una obra que no está en ninguna fuente.
 *
 * Entra con `source = 'manual'` y **todos sus campos bloqueados**: no viene de
 * Wikidata, así que no hay nada ahí fuera que deba poder cambiarla. Si algún
 * día se le encuentra su QID, se sueltan los campos que se quieran y se deja
 * que la fuente los mantenga.
 */
create or replace function create_artwork(p_datos jsonb)
returns bigint
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  nueva bigint;
  campo text;
begin
  if not is_admin() then
    raise exception 'solo un administrador puede crear obras';
  end if;

  if coalesce(p_datos ->> 'title', '') = '' then
    raise exception 'una obra necesita al menos un título';
  end if;

  for campo in select jsonb_object_keys(p_datos) loop
    if not (campo = any(campos_editables_obra() || array['institution_id', 'artist_id'])) then
      raise exception 'ese campo no se pone a mano: %', campo;
    end if;
  end loop;

  insert into artworks (title, slug, source, status, locked_fields)
  values (
    p_datos ->> 'title',
    /*
     * El slug se calcula aquí y se le pega el id después, que es como se evita
     * el choque con otra obra del mismo título sin inventar un contador.
     */
    regexp_replace(lower(unaccent(p_datos ->> 'title')), '[^a-z0-9]+', '-', 'g'),
    'manual',
    coalesce(p_datos ->> 'status', 'pending'),
    array(select jsonb_object_keys(p_datos))
  )
  returning id into nueva;

  update artworks set slug = slug || '-' || nueva where id = nueva;

  -- El resto de campos por la vía normal, que ya valida y bloquea.
  perform edit_artwork(nueva, p_datos - 'title' - 'institution_id' - 'artist_id');

  if p_datos ? 'institution_id' or p_datos ? 'artist_id' then
    perform set_config('artlas.edicion_manual', 'si', true);
    update artworks
       set institution_id = coalesce((p_datos ->> 'institution_id')::bigint, institution_id),
           artist_id      = coalesce((p_datos ->> 'artist_id')::bigint, artist_id)
     where id = nueva;
    perform set_config('artlas.edicion_manual', 'no', true);
  end if;

  return nueva;
end $fn$;

revoke execute on function edit_artwork(bigint, jsonb, text[]) from public, anon;
revoke execute on function edit_artist(bigint, jsonb, text[])  from public, anon;
revoke execute on function create_artwork(jsonb)               from public, anon;
grant  execute on function edit_artwork(bigint, jsonb, text[]) to authenticated;
grant  execute on function edit_artist(bigint, jsonb, text[])  to authenticated;
grant  execute on function create_artwork(jsonb)               to authenticated;

comment on function edit_artwork(bigint, jsonb, text[]) is
  'Corrige una obra. Lo tocado queda bloqueado: la persona gana en su campo, Wikidata en el resto.';
