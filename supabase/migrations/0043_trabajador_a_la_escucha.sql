-- ============================================================================
-- Artlas · 0043 — el trabajador dice si está escuchando
--
-- El panel sabe contar lo que PASA (0026) y recoger lo que se PIDE (0027), pero
-- no sabía lo más básico: si hay alguien al otro lado. `jobs.heartbeat_at` late
-- solo mientras se ejecuta un encargo, así que un trabajador parado y un
-- trabajador que no existe se ven exactamente igual desde la web: nada.
--
-- El síntoma es el que hace falta arreglar para que esto lo pueda usar otra
-- persona: pulsas «añadir un museo» con el trabajador apagado, el encargo se
-- queda en «esperando» —correctamente, el buzón no pierde nada— y la pantalla
-- no dice por qué ni hasta cuándo. Quien no sepa que existe un `trabajador.cmd`
-- en un ordenador de Madrid no tiene forma de averiguarlo.
--
-- Por qué una tabla y no una columna de estado: **estar vivo no es un estado
-- que se escriba, es una fecha que envejece.** Es la misma lección que dejó el
-- 28 de agosto y que ya gobierna `reap_dead_runs()`: un `running` guardado no
-- quiere decir vivo, porque un proceso que muere de golpe no actualiza nada. Un
-- `last_seen` no puede mentir en esa dirección: si nadie lo toca, envejece solo
-- y quien lo lee saca su propia conclusión. Por eso aquí no hay ni `status` ni
-- función de barrido — no hay nada que enterrar.
--
-- No toca el catálogo: se puede aplicar con una ingesta viva.
-- ============================================================================

set search_path = public, extensions;

create table workers (
  /*
   * La máquina es la identidad, y por eso es la clave. Un trabajador que se
   * cae y vuelve a arrancar es el mismo trabajador: si la clave fuera el pid,
   * cada relanzamiento del bucle de `trabajador.cmd` —que ocurre a los diez
   * segundos— dejaría una fila muerta, y en un mes habría mil filas para decir
   * lo que dice una.
   */
  host          text primary key,

  pid           integer,
  started_at    timestamptz not null default now(),

  /*
   * La única columna que importa. La edad de esta fecha es la respuesta a
   * «¿hay alguien escuchando?»; el umbral lo decide quien lee, no la base.
   */
  last_seen     timestamptz not null default now(),

  -- Qué está haciendo ahora, si es que hace algo. Null = esperando encargos.
  job_id        bigint references jobs(id) on delete set null
);

comment on table workers is
  'Señal de vida de los trabajadores. Estar vivo no es un estado que se escriba: es una fecha que envejece.';
comment on column workers.last_seen is
  'Último latido. El panel lo lee como «escuchando» si es reciente; nadie lo marca como muerto.';

-- ----------------------------------------------------------------------------
-- Quién lo ve
--
-- Solo lectura, y solo el administrador: dice qué máquinas hay y con qué pid,
-- que no es asunto de nadie más. El trabajador escribe con service_role, que se
-- salta esto.
-- ----------------------------------------------------------------------------
alter table workers enable row level security;

create policy "los administradores ven los trabajadores" on workers
  for select using (is_admin());
