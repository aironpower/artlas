-- ============================================================================
-- Artlas · 0030 — los campos que existen de verdad, y un guardián por concepto
--
-- Dos correcciones a 0028, encontradas al ir a pintar el formulario.
--
-- **1. La lista de campos editables estaba escrita de memoria.** Incluía
-- `title_es`, `genre` y `description` en obras y `bio` en artistas, y ninguna
-- de esas columnas existe. No llegó a romper nada —`asignacion_tipada()` las
-- rechaza— pero un formulario construido sobre esa lista habría tenido cuatro
-- campos que no guardan. Aquí van los nombres reales, mirados en el catálogo.
--
-- **2. `status` ya tenía su propio guardián desde 0008**, `status_locked`, con
-- el mismo razonamiento que `locked_fields`: la decisión humana sobre el estado
-- no la pisa la ingesta. Dejar los dos gobernando el mismo campo es la clase de
-- duplicidad que dentro de seis meses hace que nadie sepa cuál manda. Así que
-- **el estado sigue siendo de `status_locked`** y `locked_fields` se ocupa del
-- resto; `edit_artwork` levanta la bandera vieja cuando toca el estado, y
-- `promote.ts`, que ya la consulta, sigue funcionando sin tocarlo.
--
-- Solo reemplaza funciones: se puede aplicar con una ingesta viva.
-- ============================================================================

set search_path = public, extensions;

create or replace function campos_editables_obra()
returns text[] language sql immutable as $fn$
  select array[
    'title', 'year_start', 'year_end', 'date_display',
    'category', 'medium', 'height_cm', 'width_cm',
    'image_url', 'thumbnail_url', 'origin_url', 'source_url',
    'inventory_number', 'status', 'pending_reason',
    'rights_status', 'rights_statement'
  ]
$fn$;

create or replace function campos_editables_artista()
returns text[] language sql immutable as $fn$
  select array['name', 'sort_name', 'birth_year', 'death_year',
               'nationality', 'country_code', 'image_url']
$fn$;

/**
 * El guardián del estado (0008), enseñado a distinguir a una persona.
 *
 * Tal como estaba, una vez bloqueado el estado NADIE podía volver a cambiarlo,
 * ni siquiera desde el panel: el disparador devolvía el valor viejo también a
 * la edición manual. Servía mientras no hubiera formularios; con ellos, el
 * segundo intento de corregir un estado no habría hecho nada y sin decir por
 * qué, que es la peor forma de fallar.
 *
 * Ahora reconoce el mismo ajuste de sesión que `respetar_lo_corregido()`: solo
 * lo ponen las funciones de edición, y la ingesta —que escribe por PostgREST—
 * nunca lo pone.
 */
create or replace function keep_locked_status() returns trigger
language plpgsql set search_path = public, extensions as $fn$
begin
  if coalesce(current_setting('artlas.edicion_manual', true), '') = 'si' then
    return new;
  end if;

  if old.status_locked then
    new.status         := old.status;
    new.pending_reason := old.pending_reason;
    new.status_locked  := true;
  end if;
  return new;
end $fn$;

/**
 * Corrige una obra.
 *
 * Cada campo tocado queda bloqueado: haberlo escrito a mano ES la señal de que
 * se quiere defender. No hay casilla de «proteger esto» porque nadie corrige un
 * dato para que se lo deshagan mañana.
 *
 * El estado va por su propia puerta —`status_locked`, de 0008— para no tener
 * dos guardianes del mismo campo.
 */
create or replace function edit_artwork(
  p_id      bigint,
  p_cambios jsonb,
  p_soltar  text[] default '{}'
)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  campo     text;
  editable  text[] := campos_editables_obra();
  sets      text[] := '{}';
  bloquear  text[] := '{}';
  trozo     text;
  toca_estado boolean := p_cambios ? 'status' or p_cambios ? 'pending_reason';
begin
  if not is_admin() then
    raise exception 'solo un administrador puede corregir el catálogo';
  end if;

  for campo in select jsonb_object_keys(p_cambios) loop
    if not (campo = any(editable)) then
      raise exception 'ese campo no se edita a mano: %', campo;
    end if;

    trozo := asignacion_tipada('artworks', campo);
    if trozo is null then
      raise exception 'esa columna no existe en artworks: %', campo;
    end if;

    sets := sets || trozo;

    -- El estado no entra en `locked_fields`: tiene el suyo.
    if campo not in ('status', 'pending_reason') then
      bloquear := bloquear || campo;
    end if;
  end loop;

  if cardinality(sets) = 0 and cardinality(p_soltar) = 0 then
    return;
  end if;

  perform set_config('artlas.edicion_manual', 'si', true);

  if cardinality(sets) > 0 then
    execute format(
      'update artworks set %s%s, locked_fields = (
         select array(select distinct unnest(locked_fields || $2))
       ) where id = $3',
      array_to_string(sets, ', '),
      case when toca_estado then ', status_locked = true' else '' end
    ) using p_cambios, bloquear, p_id;
  end if;

  if cardinality(p_soltar) > 0 then
    update artworks
       set locked_fields = array(
             select unnest(locked_fields) except select unnest(p_soltar)),
           status_locked = case when 'status' = any(p_soltar) then false else status_locked end
     where id = p_id;
  end if;

  perform set_config('artlas.edicion_manual', 'no', true);
end $fn$;

comment on function edit_artwork(bigint, jsonb, text[]) is
  'Corrige una obra. Lo tocado queda bloqueado; el estado por status_locked (0008), el resto por locked_fields.';
