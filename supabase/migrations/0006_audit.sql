-- ============================================================================
-- Artlas · 0006 — auditoría del catálogo
--
-- El catálogo se llena de fuentes de terceros y lo que entra no siempre es lo
-- que dice ser. Ejemplos reales encontrados a mano en las 6.460 obras:
--
--   · 86 obras cuya miniatura devolvía un 400 (TIFF y SVG de Commons).
--   · Una obra titulada "Google Maps pin", cuya imagen es `Google Maps pin.svg`.
--   · Un artista cuyo nombre es `http://www.wikidata.org/.well-known/genid/…`,
--     que es lo que devuelve Wikidata cuando la autoría es un nodo anónimo.
--   · 7 "movimientos" que son épocas: `17th Century`, `nineteenth century`…
--   · Familias duplicadas: `Baroque`(109), `Baroque painting`(10),
--     `Baroque art`(1).
--
-- Encontrarlos a mano no escala. Esta tabla es donde el auditor deja lo que
-- encuentra, para que se pueda revisar, aceptar o descartar sin que la
-- siguiente pasada lo vuelva a sacar.
-- ============================================================================

set search_path = public, extensions;

create table audit_findings (
  id          bigint generated always as identity primary key,

  -- A qué apunta. No hay clave foránea a propósito: son cuatro tablas
  -- distintas y una FK polimórfica no existe en Postgres. La limpieza de
  -- huérfanos la hace el propio auditor, que sabe qué entidades siguen vivas.
  entity_type text not null check (entity_type in ('artwork','artist','institution','movement')),
  entity_id   bigint not null,

  rule        text not null,              -- 'image_unfetchable', 'movement_is_period'…
  severity    text not null check (severity in ('error','warning','info')),
  detail      text,                       -- el dato concreto: la URL, el nombre, el duplicado

  /*
   * Ciclo de vida:
   *   open      lo ha encontrado el auditor y nadie lo ha mirado
   *   confirmed un humano dice que es un problema de verdad
   *   dismissed un humano dice que es un falso positivo
   *   fixed     ya no se detecta
   *
   * `dismissed` es el estado importante: sin él, cada pasada del auditor
   * resucitaría los mismos falsos positivos y la bandeja sería inútil a la
   * tercera revisión. El auditor NUNCA reabre un hallazgo descartado.
   */
  status      text not null default 'open'
              check (status in ('open','confirmed','dismissed','fixed')),

  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),

  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  note        text,

  -- Un hallazgo por regla y entidad. Es lo que permite que reejecutar el
  -- auditor actualice en vez de duplicar.
  unique (entity_type, entity_id, rule)
);

create index audit_findings_triage_idx on audit_findings (status, severity, rule);
create index audit_findings_entity_idx on audit_findings (entity_type, entity_id);
create index audit_findings_rule_idx   on audit_findings (rule) where status = 'open';

comment on table audit_findings is
  'Hallazgos del auditor del catálogo. Se rellena con npm run audit (service_role).';

-- ----------------------------------------------------------------------------
-- Seguridad
--
-- Al revés que el resto del esquema: el catálogo es público de lectura, pero
-- sus defectos NO. Se activa RLS y NO se crea ninguna política, así que con la
-- anon key esta tabla no existe a efectos prácticos. Solo la service_role, que
-- salta RLS, puede escribir aquí — y es la que usa la ingesta.
--
-- Cuando llegue el panel de administración, la política que hay que añadir es
-- la que compruebe el rol en `profiles`; hasta entonces, cerrada.
-- ----------------------------------------------------------------------------
alter table audit_findings enable row level security;
