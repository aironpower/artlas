-- ============================================================================
-- Artlas · 0022 — el administrador puede revisar, no solo mirar
--
-- 0020 dejó la bandeja en solo lectura a propósito: abrir permisos de
-- escritura antes de tener la pantalla que los use es dejar una puerta abierta
-- sin puerta detrás. Ya existe la pantalla, así que se abre — con el mínimo
-- imprescindible.
--
-- Qué se puede cambiar de un hallazgo: SOLO su estado y la nota. No la regla,
-- ni la gravedad, ni a qué obra apunta — eso lo escribe el auditor y que un
-- humano lo reescriba desde el navegador sería inventar un hallazgo que nadie
-- ha detectado.
--
-- Esta tabla no toca `artworks`, así que se puede aplicar con una ingesta viva.
-- ============================================================================

set search_path = public, extensions;

/**
 * Revisar un hallazgo.
 *
 * Se hace con una función y no con una política de UPDATE directa por una
 * razón concreta: una política no puede impedir que se cambien OTRAS columnas
 * de la misma fila. `with check` valida el resultado, pero comparar cada
 * columna con su valor anterior dentro de la política es ilegible y fácil de
 * dejar incompleto al añadir una columna nueva.
 *
 * Aquí la función escribe exactamente tres campos y no hay forma de tocar el
 * resto. Además deja constancia de QUIÉN revisó y cuándo, que es medio sentido
 * de tener una bandeja.
 */
create or replace function review_finding(
  p_finding_id bigint,
  p_status     text,
  p_note       text default null
)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not is_admin() then
    raise exception 'solo un administrador puede revisar hallazgos';
  end if;

  if p_status not in ('open', 'confirmed', 'dismissed') then
    raise exception 'estado no válido: %', p_status;
  end if;

  /*
   * `fixed` no está en la lista de estados que puede poner una persona, y es
   * deliberado: significa "ya no se detecta" y eso lo decide el auditor al
   * dejar de encontrarlo. Que alguien lo marcara a mano sería afirmar que
   * arregló algo que la máquina sigue viendo.
   */
  update audit_findings
     set status      = p_status,
         note        = coalesce(p_note, note),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_finding_id;
end $fn$;

revoke execute on function review_finding(bigint, text, text) from anon;
grant execute on function review_finding(bigint, text, text) to authenticated;

comment on function review_finding(bigint, text, text) is
  'Marca un hallazgo como confirmado o descartado. Comprueba el rol dentro: no basta con poder llamarla.';
