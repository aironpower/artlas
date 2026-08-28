-- ============================================================================
-- Artlas · 0007 — puerta de entrada de la ingesta
--
-- 0006 audita lo que YA está dentro. Esto es para lo que está entrando: la
-- ingesta pasa cada obra por las mismas reglas antes de escribirla, y lo que
-- no supera las reglas duras no llega al catálogo.
--
-- El problema de rechazar es que lo rechazado desaparece sin dejar rastro, y
-- entonces nadie puede saber si la puerta está haciendo bien su trabajo o está
-- tirando obras buenas. Esta tabla es ese rastro.
-- ============================================================================

set search_path = public, extensions;

create table ingest_rejects (
  id           bigint generated always as identity primary key,

  -- Identidad en el ORIGEN, no en el catálogo: estas filas no llegaron a
  -- existir como obra, así que no hay artwork_id al que apuntar.
  source       text not null,
  source_id    text not null,
  wikidata_qid text,
  title        text,
  institution  text,                    -- nombre del museo por el que entraba

  rule         text not null,           -- 'image_is_vector', 'title_is_url'…
  detail       text,

  /*
   * `admitted` es una decisión humana que la ingesta OBEDECE: al arrancar
   * carga los admitidos y deja pasar esas obras aunque la regla las siga
   * marcando. Sin esa válvula, corregir un falso rechazo obligaría a tocar
   * código y volver a desplegar, y la reacción natural sería aflojar la regla
   * para todos — que es como se degradan estos sistemas.
   */
  status       text not null default 'rejected'
               check (status in ('rejected','admitted','ignored')),

  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  reviewed_by  uuid references auth.users(id) on delete set null,
  reviewed_at  timestamptz,
  note         text,

  unique (source, source_id, rule)
);

create index ingest_rejects_triage_idx on ingest_rejects (status, rule);
create index ingest_rejects_source_idx on ingest_rejects (source, source_id);

comment on table ingest_rejects is
  'Obras que la puerta de entrada no dejó entrar, y por qué. status=admitted las deja pasar en la siguiente ingesta.';

-- Cerrada igual que audit_findings: RLS activo y ninguna política, así que
-- solo la service_role llega. La política por rol llegará con el panel.
alter table ingest_rejects enable row level security;
