-- ============================================================================
-- Artlas · 0016 — movimientos canónicos y sus alias
--
-- Tras el barrido hay 237 movimientos, y 17 familias son el mismo movimiento
-- escrito de varias formas:
--
--     Baroque(144) · Baroque painting(23) · Baroque art(1)
--     Italian Renaissance(94) · Italian Renaissance painting(11)
--     modernism(23) · Modernism(4)
--     surrealism(4) · surrealism(0)      <- mismo nombre, dos filas
--
-- Unas 381 obras cuelgan del duplicado equivocado, así que filtrar por
-- "Barroco" no las encuentra. Wikidata no tiene la culpa: son ítems distintos
-- allí también, con matices que a un catálogo de museo no le sirven de nada.
--
-- Esta tabla es la memoria de esas decisiones. Sin ella, fusionar duplicados
-- sería tirar trabajo a la basura: la siguiente ingesta volvería a crear
-- "Baroque painting" en cuanto una obra lo declarara.
-- ============================================================================

set search_path = public, extensions;

create table movement_aliases (
  id          bigint generated always as identity primary key,

  -- Se puede aliasar por QID (lo que dice Wikidata) o por slug (lo que llegó
  -- como texto libre desde la API de un museo). Al menos uno de los dos.
  alias_qid   text unique,
  alias_slug  text unique,

  movement_id bigint not null references movements(id) on delete cascade,

  -- Por qué se decidió: 'duplicado de X', 'no es un movimiento sino una época'…
  reason      text,
  created_at  timestamptz not null default now(),

  check (alias_qid is not null or alias_slug is not null)
);

create index movement_aliases_target_idx on movement_aliases (movement_id);

comment on table movement_aliases is
  'Nombres y QID que deben resolverse a un movimiento canónico. La ingesta lo consulta antes de crear uno nuevo.';

-- Es catálogo: público de lectura como el resto.
alter table movement_aliases enable row level security;
create policy "catalogo publico" on movement_aliases for select using (true);
