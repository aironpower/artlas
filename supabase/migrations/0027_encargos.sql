-- ============================================================================
-- Artlas · 0027 — encargos: la web pide, la máquina de casa ejecuta
--
-- Manuel quiere lanzar y seguir las ingestas y las comprobaciones desde la web,
-- y quiere que eso dure: añadir un museo o unos cuadros es tarea de siempre, no
-- de una tarde.
--
-- Por qué un buzón en la base y no un botón que ejecute:
--
-- Un barrido dura horas y la web vive en Vercel, que corta las funciones a
-- segundos. Alojar algo que aguante horas cuesta dinero, y el plan gratuito es
-- una restricción del proyecto, no un detalle. Así que la web **encarga**, un
-- trabajador que vive en la máquina de Manuel **ejecuta**, y esta tabla es el
-- buzón entre los dos. Nadie tiene que estar delante.
--
-- La regla de seguridad que gobierna el diseño: **`kind` es una lista cerrada y
-- los argumentos son datos, nunca una orden**. El trabajador traduce cada
-- `kind` a un comando fijo que él conoce y valida los argumentos uno a uno. Sin
-- eso, esta tabla sería un intérprete de comandos con formulario web delante.
--
-- No toca el catálogo: se puede aplicar con una ingesta viva.
-- ============================================================================

set search_path = public, extensions;

create table jobs (
  id            bigint generated always as identity primary key,

  /*
   * Lista cerrada, y a propósito. Añadir un proceso nuevo obliga a tocar esta
   * restricción Y el mapa del trabajador: dos sitios, los dos en el repositorio
   * y los dos revisables. Es más incómodo que un campo libre, y esa incomodidad
   * es la que impide que un día alguien encargue `rm -rf`.
   */
  kind          text not null check (kind in (
                  'ingest', 'fill-images', 'promote', 'audit', 'refresh', 'check-db'
                )),

  -- Datos, no orden. El trabajador valida cada clave contra lo que espera.
  args          jsonb not null default '{}'::jsonb,

  status        text not null default 'queued'
                check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),

  requested_by  uuid references auth.users(id) on delete set null,
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,

  /*
   * Señal de vida del trabajador, no del encargo. Igual que en 0026: un
   * `running` sin latido reciente no es un proceso trabajando, es un proceso
   * que ya no está.
   */
  heartbeat_at  timestamptz,

  cancel_requested boolean not null default false,

  exit_code     integer,
  error         text,

  /*
   * La cola de la salida del proceso, para poder seguirlo desde el panel sin
   * abrir un fichero. **La cola, no todo**: el barrido del 28 de agosto escupió
   * 6.546 líneas y guardarlas enteras aquí sería pagar con el espacio de la
   * base —500 MB en total— por algo que ya está en `ingesta.log`. El trabajador
   * recorta; el detalle completo vive en disco.
   */
  output        text,

  -- Si el encargo es una ingesta, su fila en `ingest_runs`, con el detalle por museo.
  run_id        bigint references ingest_runs(id) on delete set null
);

create index jobs_cola_idx on jobs (requested_at desc);
create index jobs_pendientes_idx on jobs (requested_at) where status = 'queued';

-- ----------------------------------------------------------------------------
-- Encargar
-- ----------------------------------------------------------------------------

/**
 * Pide un trabajo. Devuelve su id.
 *
 * Comprueba el rol DENTRO, como todo lo que escribe en este proyecto: que la
 * pantalla esté protegida es comodidad, no la garantía.
 *
 * Rechaza encargar si ya hay uno del mismo tipo esperando o corriendo. No es
 * una limitación técnica —el trabajador va de uno en uno— sino de sentido: dos
 * barridos a la vez se pisan el catálogo, y ya tumbaron un museo entero el 28
 * de agosto. Y sin esto, pulsar dos veces un botón encarga dos veces.
 */
create or replace function request_job(p_kind text, p_args jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  nuevo bigint;
begin
  if not is_admin() then
    raise exception 'solo un administrador puede encargar trabajos';
  end if;

  if exists (select 1 from jobs where kind = p_kind and status in ('queued', 'running')) then
    raise exception 'ya hay un «%» esperando o en curso', p_kind;
  end if;

  insert into jobs (kind, args, requested_by)
  values (p_kind, coalesce(p_args, '{}'::jsonb), auth.uid())
  returning id into nuevo;

  return nuevo;
end $fn$;

/**
 * Pedir que pare, o quitar de la cola.
 *
 * Un encargo que aún espera se cancela en el sitio: nadie lo ha empezado. Uno
 * en curso solo levanta la bandera —el trabajador la mira y sale por su propio
 * pie— porque matarlo a mitad deja museos sin checkpoint y trabajo que rehacer.
 */
create or replace function cancel_job(p_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not is_admin() then
    raise exception 'solo un administrador puede cancelar trabajos';
  end if;

  update jobs
     set status           = case when status = 'queued' then 'cancelled' else status end,
         finished_at      = case when status = 'queued' then now() else finished_at end,
         cancel_requested = true
   where id = p_id and status in ('queued', 'running');
end $fn$;

/**
 * Cierra los encargos cuyo trabajador dejó de dar señales.
 *
 * Mismo motivo y mismo margen que `reap_dead_runs()` (0026): diez minutos sin
 * latir no es un proceso lento, es un proceso que no está. Sin esto, apagar el
 * ordenador con un barrido en marcha deja el encargo diciendo «en curso» para
 * siempre, y el buzón bloqueado: `request_job` no dejaría encargar otro igual.
 */
create or replace function reap_dead_jobs()
returns integer
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  n integer;
begin
  with muertos as (
    update jobs
       set status      = 'failed',
           finished_at = coalesce(heartbeat_at, started_at, now()),
           error       = coalesce(error, 'el trabajador dejó de dar señales; el proceso ya no está')
     where status = 'running'
       and coalesce(heartbeat_at, started_at) < now() - interval '10 minutes'
    returning id
  )
  select count(*) into n from muertos;

  return n;
end $fn$;

revoke execute on function request_job(text, jsonb) from public, anon;
revoke execute on function cancel_job(bigint)      from public, anon;
revoke execute on function reap_dead_jobs()        from public, anon;
grant  execute on function request_job(text, jsonb) to authenticated;
grant  execute on function cancel_job(bigint)       to authenticated;
grant  execute on function reap_dead_jobs()         to authenticated;

-- ----------------------------------------------------------------------------
-- Quién lo ve
--
-- Solo lectura, y solo el administrador. Encargar y cancelar pasan por las
-- funciones de arriba, que comprueban el rol; el trabajador escribe con
-- service_role, que se salta esto.
-- ----------------------------------------------------------------------------
alter table jobs enable row level security;

create policy "los administradores ven los encargos" on jobs
  for select using (is_admin());

comment on table jobs is
  'Buzón entre la web y el trabajador de casa. `kind` es lista cerrada: los argumentos son datos, nunca una orden.';
