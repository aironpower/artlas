-- ============================================================================
-- Artlas · 0026 — la ingesta deja de contarse por el log
--
-- El caso que obliga a esto: el barrido del 28 de agosto de 2026 dejó 6.546
-- líneas de log de las que ~6.400 eran `reintento N/M`. Filadelfia agotó sus
-- reintentos y murió a las 19:17; el Met quedó cortado a la mitad. Se supo
-- catorce horas después, y solo porque alguien leyó el fichero a mano.
--
-- Un log es un buen sitio para el detalle y un pésimo sitio para el estado: no
-- se puede preguntar «¿en qué museo va?» sin leerlo entero, y no distingue
-- «terminó» de «murió». Aquí van las dos tablas que sí responden a eso, y las
-- lee el panel.
--
-- Ninguna de estas tablas es el catálogo: se puede aplicar con una ingesta
-- viva sin bloquear `artworks`.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- Una ejecución: un `npm run start` de principio a fin
-- ----------------------------------------------------------------------------
create table ingest_runs (
  id            bigint generated always as identity primary key,

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,

  /*
   * `running` no significa viva: significa que nadie escribió el final. Un
   * proceso que muere de golpe —y el del 28 murió— deja su fila exactamente
   * así para siempre. Por eso `heartbeat_at` es obligatorio y por eso existe
   * `reap_dead_runs()` más abajo: sin ellos el panel enseñaría «en curso»
   * durante catorce horas con la misma cara de tranquilidad que tenía el log.
   */
  status        text not null default 'running'
                check (status in ('running', 'done', 'failed', 'cancelled')),

  -- Con qué opciones se lanzó. Sin esto dos ejecuciones son indistinguibles.
  command       text,
  host          text,
  pid           integer,

  museums_total integer,
  museums_done  integer not null default 0,

  -- Señal de vida del proceso, cada 30 s por reloj. No dice si avanza: solo si está.
  heartbeat_at  timestamptz not null default now(),

  /*
   * Parar desde la pantalla. La ingesta lo mira entre museos y sale limpia:
   * matar el proceso a mano deja lotes a medias y museos sin checkpoint, o
   * sea, trabajo que hay que rehacer entero.
   */
  cancel_requested boolean not null default false,

  error         text,

  /*
   * Los totales del resumen final, tal cual los cuenta la ingesta. En JSON y no
   * en columnas porque son el resumen para leer, no algo por lo que se filtre:
   * las cifras que se consultan de verdad están en `ingest_steps`, una por
   * museo, y sumarlas de ahí siempre da la verdad aunque esto falte.
   */
  stats         jsonb not null default '{}'::jsonb
);

create index ingest_runs_recientes_idx on ingest_runs (started_at desc);
create index ingest_runs_vivas_idx on ingest_runs (heartbeat_at desc) where status = 'running';

-- ----------------------------------------------------------------------------
-- Un paso: un museo dentro de una ejecución
-- ----------------------------------------------------------------------------
create table ingest_steps (
  id            bigint generated always as identity primary key,
  run_id        bigint not null references ingest_runs(id) on delete cascade,

  position      integer not null,
  museum_qid    text not null,
  museum_name   text not null,

  status        text not null default 'running'
                check (status in ('running', 'done', 'failed', 'skipped', 'incomplete')),

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,

  fetched       integer not null default 0,
  inserted      integer not null default 0,
  published     integer not null default 0,
  pending       integer not null default 0,
  rejected      integer not null default 0,
  duplicated    integer not null default 0,
  repaired      integer not null default 0,

  /*
   * Las obras que no llegaron a mirarse porque su lote falló. Es la cifra que
   * distingue «el museo está hecho» de «el museo parece hecho», y la que hace
   * que el siguiente barrido lo rehaga.
   */
  lost_works    integer not null default 0,
  lost_batches  integer not null default 0,

  /*
   * Reintentos gastados en este museo. Las ~6.400 líneas de reintento del 28
   * caben aquí en un número, y ese número avisa de que una fuente se está
   * portando mal ANTES de que agote la paciencia del proceso.
   */
  retries       integer not null default 0,

  error         text,
  note          text
);

create index ingest_steps_run_idx on ingest_steps (run_id, position);

-- ----------------------------------------------------------------------------
-- Enterrar a los muertos
-- ----------------------------------------------------------------------------

/**
 * Cierra las ejecuciones que dejaron de dar señales.
 *
 * La llama la ingesta al arrancar y también el panel al pintarse, y por eso es
 * `security definer`: el panel lee con la sesión del administrador y no tiene
 * permiso de escritura sobre estas tablas — ni debe tenerlo para esto.
 *
 * Diez minutos de margen sobre un latido que la ingesta escribe cada 30 s por
 * reloj: veinte latidos perdidos no son una fuente lenta, son un proceso que
 * ya no está.
 *
 * El latido dice «existo», no «avanzo», y esa distinción es deliberada. Atado
 * al trabajo hecho —un latido por lote escrito— una consulta atascada deja de
 * latir estando viva: hasta 8 min entre reintentos, y el Met, con dos horas y
 * media de museo, se habría dado por muerto a los diez minutos. Un vigilante
 * que mata al vigilado es peor que no tener vigilante. Si avanza o no se ve en
 * las cifras del museo en curso y en sus reintentos, que son otra pregunta.
 */
create or replace function reap_dead_runs()
returns integer
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  n integer;
begin
  with muertas as (
    update ingest_runs
       set status      = 'failed',
           finished_at = heartbeat_at,
           error       = coalesce(
             error,
             'el proceso murió sin decir nada: última señal de vida a las '
             || to_char(heartbeat_at, 'HH24:MI')
           )
     where status = 'running'
       and heartbeat_at < now() - interval '10 minutes'
    returning id
  )
  select count(*) into n from muertas;

  -- Un paso no puede seguir corriendo si su ejecución está muerta.
  update ingest_steps s
     set status      = 'failed',
         finished_at = coalesce(s.finished_at, now()),
         error       = coalesce(s.error, 'la ejecución murió durante este museo')
    from ingest_runs r
   where s.run_id = r.id
     and s.status = 'running'
     and r.status <> 'running';

  return n;
end $fn$;

/**
 * Pedir que pare.
 *
 * No mata nada: levanta una bandera que la ingesta mira entre museos. Lo que
 * ve quien pulsa es «se está parando», y eso es honesto — el museo en curso
 * puede tardar minutos en terminar, y cortarlo por la mitad costaría rehacerlo.
 */
create or replace function request_ingest_cancel(p_run_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not is_admin() then
    raise exception 'solo un administrador puede parar la ingesta';
  end if;

  update ingest_runs
     set cancel_requested = true
   where id = p_run_id and status = 'running';
end $fn$;

revoke execute on function request_ingest_cancel(bigint) from anon;
grant execute on function request_ingest_cancel(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- Quién lo ve
--
-- Solo el administrador, y por RLS: la ingesta escribe con service_role, que
-- se salta esto. Sin política de escritura a propósito — parar se pide con
-- `request_ingest_cancel`, que comprueba el rol dentro.
-- ----------------------------------------------------------------------------
alter table ingest_runs  enable row level security;
alter table ingest_steps enable row level security;

create policy "los administradores ven las ejecuciones" on ingest_runs
  for select using (is_admin());

create policy "los administradores ven los pasos" on ingest_steps
  for select using (is_admin());

/*
 * `reap_dead_runs()` se revoca de PUBLIC. Postgres deja ejecutar las funciones
 * nuevas a cualquiera, y esta escribe: lo que hace es correcto lo llame quien
 * lo llame —cierra ejecuciones que llevan diez minutos sin dar señales, y esas
 * están muertas de verdad—, pero una escritura disparable sin identificarse no
 * es la convención de este proyecto (ver 0022).
 *
 * No comprueba `is_admin()` dentro a propósito: enterrar a un muerto no es una
 * decisión, es mantenimiento, y exigir rol obligaría al panel a distinguir dos
 * errores distintos para un caso que no aporta nada.
 */
revoke execute on function reap_dead_runs() from public;
revoke execute on function reap_dead_runs() from anon;
grant  execute on function reap_dead_runs() to authenticated;

comment on table ingest_runs is
  'Una ejecución de la ingesta. `running` no quiere decir viva: mira heartbeat_at.';
comment on table ingest_steps is
  'Un museo dentro de una ejecución, con sus cifras y su error si lo tuvo.';
