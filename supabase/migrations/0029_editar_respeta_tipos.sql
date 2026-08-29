-- ============================================================================
-- Artlas · 0029 — corregir un año no es corregir un texto
--
-- Fallo de 0028: el UPDATE dinámico casteaba todos los valores a `text`, y
-- `year_start` es `integer`. Postgres lo paró en seco —«column year_start is of
-- type integer but expression is of type text»— así que nunca llegó a escribir
-- nada mal; simplemente no se podía corregir ningún campo que no fuera texto.
--
-- El arreglo: preguntarle al catálogo el tipo real de cada columna en vez de
-- suponerlo. `pg_attribute` lo sabe, y de paso el `%I` sigue escapando el
-- nombre y los valores siguen viajando como parámetro: nada de lo que llega
-- del formulario se concatena en el SQL.
--
-- Solo reemplaza funciones. No toca `artworks` ni `artists`, así que se puede
-- aplicar con una ingesta viva — que es exactamente lo que había cuando se
-- encontró el fallo.
-- ============================================================================

set search_path = public, extensions;

/**
 * `campo = ($1 ->> 'campo')::<su tipo real>` para una columna de una tabla.
 *
 * Devuelve NULL si la columna no existe, lo que además sirve de comprobación:
 * un campo que no está en la tabla no genera asignación y se rechaza antes.
 */
create or replace function asignacion_tipada(p_tabla regclass, p_campo text)
returns text
language sql stable set search_path = public, extensions as $fn$
  select format('%I = ($1 ->> %L)::%s', p_campo, p_campo, atttypid::regtype)
    from pg_attribute
   where attrelid = p_tabla and attname = p_campo and attnum > 0 and not attisdropped
$fn$;

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
  trozo    text;
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
  end loop;

  if cardinality(sets) = 0 and cardinality(p_soltar) = 0 then
    return;
  end if;

  -- Deja pasar el disparador: esta escritura SÍ puede tocar lo bloqueado.
  perform set_config('artlas.edicion_manual', 'si', true);

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
  trozo    text;
begin
  if not is_admin() then
    raise exception 'solo un administrador puede corregir el catálogo';
  end if;

  for campo in select jsonb_object_keys(p_cambios) loop
    if not (campo = any(editable)) then
      raise exception 'ese campo no se edita a mano: %', campo;
    end if;

    trozo := asignacion_tipada('artists', campo);
    if trozo is null then
      raise exception 'esa columna no existe en artists: %', campo;
    end if;
    sets := sets || trozo;
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

comment on function asignacion_tipada(regclass, text) is
  'El tipo de cada columna se pregunta, no se supone: 0028 casteaba los años a texto.';
