-- ============================================================================
-- Artlas · 0039 — que el panel distinga «hecho» de «no hacía falta»
--
-- Hasta ahora `ingest_steps` solo tenía `inserted`, y la ingesta la rellenaba
-- con el lote entero: escribía todas las filas siempre, así que «escritas» y
-- «obras del museo» eran el mismo número y no había nada más que contar.
--
-- Con la ingesta incremental esa cifra se parte en tres, y las tres importan
-- por motivos distintos:
--
--   inserted   obras que no estaban. Es el catálogo creciendo.
--   updated    obras que ya estaban y han cambiado. Es Wikidata corrigiéndose,
--              y sobre todo es la cifra que dice si ha aparecido una foto
--              nueva para alguna de las 133.898 que esperan.
--   unchanged  obras que ya estaban idénticas y no se han tocado.
--
-- La tercera es la que faltaba para poder contestar «¿ha servido de algo
-- volver a preguntar?». Sin ella, un refresco donde no cambió nada y uno donde
-- cambió medio museo se ven exactamente igual desde el panel: los dos dicen
-- «hecho». Un panel que no distingue esas dos cosas invita a repetir un
-- trabajo de horas por si acaso.
--
-- Van con `default 0` y sin `not null` retroactivo que rellenar: los pasos
-- viejos se quedan con cero, que es lo honesto —de esas ejecuciones no
-- sabemos cuántas obras cambiaron, porque nadie lo midió—.
-- ============================================================================

set search_path = public, extensions;

alter table ingest_steps add column if not exists updated   integer not null default 0;
alter table ingest_steps add column if not exists unchanged integer not null default 0;

comment on column ingest_steps.updated is
  'Obras que ya estaban y esta pasada cambió. Cero significa que Wikidata no ha movido nada.';
comment on column ingest_steps.unchanged is
  'Obras que ya estaban idénticas y no se tocaron. Es el ahorro de la ingesta incremental.';
