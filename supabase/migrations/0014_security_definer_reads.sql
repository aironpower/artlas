-- ============================================================================
-- Artlas · 0014 — RLS estaba impidiendo usar el índice geográfico
--
-- Medido por el MISMO camino que el navegador (anon key, no service_role):
--
--     cerca de mí (Prado, 2 km)   3.141 ms  ->  canceling statement due to
--                                               statement timeout
--
-- La misma consulta con service_role tardaba 642 ms. La diferencia es RLS.
--
-- Con una política activa, Postgres aplica su condición ANTES que el resto,
-- salvo que las demás sean "leakproof" — garantía de que no filtran
-- información por mensajes de error. `st_dwithin` no lo es, así que no puede
-- evaluarse antes que la política, y eso deja fuera de juego el índice GiST
-- sobre `location`: en lugar de buscar por proximidad, filtra 113.783 filas por
-- estado y luego calcula distancias.
--
-- La salida es SECURITY DEFINER: la función se ejecuta con los permisos de su
-- dueño, salta RLS, y el planificador vuelve a poder usar el índice.
--
-- ⚠ Y AQUÍ ESTÁ EL PRECIO, que hay que entender antes de tocar nada:
--
--   Al saltar RLS, la política deja de ser la garantía de qué se ve. La
--   garantía pasa a ser el `where a.status = 'published'` escrito DENTRO de
--   cada función. Quien quite esa línea creyendo que es redundante estará
--   publicando las 59.000 obras que esperan datos.
--
--   Por eso las tres funciones la llevan explícita y comentada, y por eso no
--   se hace SECURITY DEFINER de nada más: `artworks` sigue con su política
--   para cualquier otro acceso, que es la mayoría.
-- ============================================================================

set search_path = public, extensions;

-- `search_path` fijo en cada función es obligatorio con SECURITY DEFINER: sin
-- él, quien pueda crear objetos en un esquema anterior del search_path podría
-- suplantar una tabla y ejecutar código con los permisos del dueño.

alter function artworks_near(double precision, double precision, text, int, text, int)
  security definer;

alter function artworks_by_artist(text, text, int)
  security definer;

alter function search_artworks(text, text, text, text, text, int, int, text, int)
  security definer;

-- Que sigan siendo llamables desde el navegador.
grant execute on function artworks_near(double precision, double precision, text, int, text, int) to anon, authenticated;
grant execute on function artworks_by_artist(text, text, int) to anon, authenticated;
grant execute on function search_artworks(text, text, text, text, text, int, int, text, int) to anon, authenticated;

comment on function artworks_near(double precision, double precision, text, int, text, int) is
  'SECURITY DEFINER para poder usar el índice GiST. El filtro status = published de dentro es la única garantía de visibilidad: no quitarlo.';
