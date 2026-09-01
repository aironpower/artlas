-- ============================================================================
-- Artlas · 0042 — la notoriedad, sin abrir la fila entera
--
-- Complemento medido de `0041`, no un adorno.
--
-- Buscar termina eligiendo por `order by puntuación, notability, id`. Para
-- ordenar hace falta la notoriedad de cada candidata, y hasta ahora eso
-- significaba ir a buscar la FILA de `artworks` —unos 900 bytes con título,
-- URLs, fechas y descripción— para leer un entero. Con 16.549 candidatas
-- («portrait») son 16.549 saltos al montón para quedarse con 37.
--
-- Este índice lleva la notoriedad dentro, así que ese paso se resuelve sin
-- tocar la tabla. Solo cubre las publicadas, que son las únicas que la
-- búsqueda mira: 135.261 de 269.159 filas, unos 3 MB.
--
-- Medido con la base en régimen estable, mediana de cuatro pasadas:
--
--                 sin índice   con índice
--   "art"            3.050 ms     2.622 ms
--   "de"             3.614 ms     2.737 ms
--
-- No es espectacular y es justo donde importa: son las dos que cruzaban los
-- 3 s del rol `anon`, es decir, las dos que devolvían un error en vez de una
-- página. Las estrechas ya iban sobradas y no cambian.
-- ============================================================================

set search_path = public, extensions;

create index if not exists artworks_id_notability_pub
  on artworks (id) include (notability)
  where status = 'published';
