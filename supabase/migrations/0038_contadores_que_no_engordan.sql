-- ============================================================================
-- Artlas · 0038 — contadores que no engordan la base ni mueren a los 8 s
--
-- `refresh_artwork_counters` llevaba avisada en NOTAS desde el 29 de agosto
-- («ya rozan el statement_timeout, habrá que mirarlo»). Con 269.159 obras
-- dentro ya no roza: **falla**. `npm run check-db` lo da por roto hoy:
--
--     ✗ refresh_artwork_counters canceling statement due to statement timeout
--
-- Y un contador que no se puede recalcular es un contador que miente en cuanto
-- entra un museo, porque es lo que enseña el mapa y las fichas.
--
-- Son dos problemas distintos, medidos por separado antes de tocar nada.
--
-- ## 1. Escribía 21.600 filas para no cambiar ninguna
--
-- La versión vieja son seis UPDATE: tres que ponen la cuenta y tres que
-- devuelven a cero al que se quedó sin obras. Ninguno miraba si el valor ya
-- era el bueno. Cronometrado sobre el catálogo real:
--
--     institutions set     8713 ms      48 filas escritas
--     institutions zero    1420 ms       0
--     artists set          2396 ms  11.425 filas escritas
--     artists zero         3243 ms  10.194 filas escritas
--     movements set        3047 ms     186 filas escritas
--
-- 21.600 filas reescritas en cada pasada aunque el catálogo no se hubiera
-- movido, y en Postgres reescribir una fila deja la vieja muerta. **Es el
-- mismo error que infló `audit_findings` hasta comerse 121 MB**: guardar lo
-- que ya era verdad. Con la base al 79% de los 500 MB del plan gratuito, eso
-- no es un detalle de rendimiento.
--
-- Aquí va un solo UPDATE por tabla, con `left join` a la cuenta —que ya
-- devuelve 0 al que no aparece, así que el paso «zero» sobra— y un
-- `is distinct from` que descarta el que ya está bien. Misma medición:
--
--     institutions         6904 ms   0 filas escritas
--     artists              2560 ms   0
--     movements            1111 ms   0
--
-- Cero. Los contadores ya eran correctos, así que ahora no se escribe nada y
-- no se deja una sola fila muerta. Cuando el catálogo sí cambie se escribirá
-- lo que haya cambiado, que es de lo que se trata.
--
-- ## 2. Ocho segundos que no eran suyos
--
-- Los tiempos de arriba son de caché fría. En caliente el mismo agregado baja
-- a 150-220 ms: no falta ningún índice —se probó uno parcial por
-- `institution_id` y solo daba 223→158 ms por 2 MB, no compensa—, lo que pasa
-- es que la primera pasada del día lee 163 MB de disco en una instancia del
-- plan gratuito.
--
-- Y el límite que la mataba no es de la función sino del rol: PostgREST
-- conecta como `authenticator`, que tiene `statement_timeout = 8s`, y
-- `service_role` no lo levanta. Por eso `promote` nunca falló —va por
-- conexión directa— y `check-db` sí, que va por RPC.
--
-- La cláusula `set statement_timeout` de la función se aplica durante toda su
-- ejecución y gana al valor del rol. Comprobado, no supuesto, con dos
-- funciones iguales salvo el SET llamadas por HTTP como las llama la app:
--
--     tmp_sin_set      8293 ms  ✗ canceling statement due to statement timeout
--     tmp_con_set     12083 ms  ✓ terminó
--
-- 120 s es holgura para el arranque en frío, no permiso para tardar: si esto
-- se acerca al minuto con el catálogo caliente, el problema es otro y hay que
-- volver a mirarlo.
-- ============================================================================

set search_path = public, extensions;

create or replace function refresh_artwork_counters()
returns void language plpgsql
set search_path = public, extensions
set statement_timeout = '120s' as $fn$
begin
  -- El `left join` cubre los dos casos de una vez: el museo que tiene obras
  -- publicadas recibe su cuenta, y el que se quedó sin ninguna recibe el 0 del
  -- `coalesce` en lugar de conservar el contador viejo y seguir en el mapa.
  update institutions i set artwork_count = n.c
    from (select i2.id, coalesce(a.n, 0) c
            from institutions i2
            left join (select institution_id, count(*) n from artworks
                        where institution_id is not null and status = 'published'
                        group by institution_id) a on a.institution_id = i2.id) n
   where n.id = i.id
     and i.artwork_count is distinct from n.c;

  update artists ar set artwork_count = n.c
    from (select a2.id, coalesce(a.n, 0) c
            from artists a2
            left join (select artist_id, count(*) n from artworks
                        where artist_id is not null and status = 'published'
                        group by artist_id) a on a.artist_id = a2.id) n
   where n.id = ar.id
     and ar.artwork_count is distinct from n.c;

  update movements m set artwork_count = n.c
    from (select m2.id, coalesce(a.n, 0) c
            from movements m2
            left join (select am.movement_id, count(*) n
                         from artwork_movements am
                         join artworks a on a.id = am.artwork_id
                        where a.status = 'published'
                        group by am.movement_id) a on a.movement_id = m2.id) n
   where n.id = m.id
     and m.artwork_count is distinct from n.c;
end $fn$;
