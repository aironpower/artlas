-- ============================================================================
-- Artlas · 0024 — el índice que sostiene la paginación de un museo
--
-- Medido antes de escribirlo, sobre la página 50 del Prado (36 obras a partir
-- de la 1.764), cinco pasadas cada uno:
--
--   sin índice   79, 94, 111, 131, 2140 ms   ← top-N heapsort de 1.800 filas
--   con índice   67,  71,  71,  71,   76 ms
--
-- La mediana apenas cambia; lo que desaparece es la cola. Y la cola es lo que
-- importa: el rol `anon` tiene statement_timeout de 3 s, así que ese 2.140 con
-- la caché fría es un 500 en la cara del visitante. Es el mismo error que ya
-- se cometió dos veces —medir por el camino cómodo— visto desde el otro lado.
--
-- El orden de las columnas es el del `order by` de artworks_by_institution, y
-- por eso incluye `notability desc`. Parcial sobre `published` porque la
-- función lo nombra explícitamente: si algún día deja de nombrarlo, el índice
-- deja de usarse sin avisar (0009 ya nos lo enseñó).
-- ============================================================================

create index if not exists artworks_institution_order_idx
  on artworks (institution_id, notability desc, year_start, id)
  where status = 'published';
