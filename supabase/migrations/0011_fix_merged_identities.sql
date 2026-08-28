-- ============================================================================
-- Artlas · 0011 — filas con la identidad de dos obras mezcladas
--
-- El barrido completo dejó 1.567 filas cuyo `source_id` es el QID de una obra y
-- cuyo `wikidata_qid` es el de OTRA. Ejemplo real: source_id Q26692296 con
-- wikidata_qid Q26692289, "Scenes from Tebaldeo's Eclogues".
--
-- Causa: el deduplicador emparejaba por huella (título + autor + década) y en
-- Wikidata es normal que los paneles de un mismo retablo compartan los tres.
-- Dos ítems distintos se fundían en una fila, quedándose con el `source_id` de
-- uno y el `wikidata_qid` del otro. Ya está corregido en `normalize.ts`: dos
-- QID distintos son obras distintas y no se fusionan.
--
-- Consecuencia práctica del desaguisado: la siguiente ingesta intentaba
-- insertar la obra "perdida", su QID chocaba contra `artworks_wikidata_qid_key`
-- y el ON CONFLICT (source, source_id) no lo interceptaba porque el source_id
-- era otro. Así se cayeron 10 de los 48 museos a mitad de escritura.
--
-- Esta migración devuelve a esas filas una identidad coherente. Su hermana
-- perdida reaparecerá sola la próxima vez que se ingiera ese museo, ahora que
-- el deduplicador ya no las mezcla.
-- ============================================================================

set search_path = public, extensions;

/*
 * Solo donde no genere un choque nuevo: si otra fila ya ocupa ese
 * (source, source_id), esta se queda como está y se verá en el recuento de
 * abajo. Preferimos dejar constancia de lo que no se pudo arreglar antes que
 * borrar una fila para hacer sitio.
 */
update artworks a
   set source_id = a.wikidata_qid
 where a.wikidata_qid is not null
   and a.source_id is distinct from a.wikidata_qid
   and not exists (
     select 1 from artworks b
      where b.source = a.source
        and b.source_id = a.wikidata_qid
        and b.id <> a.id
   );

do $$
declare quedan int;
begin
  select count(*) into quedan
    from artworks
   where wikidata_qid is not null and source_id is distinct from wikidata_qid;

  if quedan > 0 then
    raise notice 'Quedan % filas con identidad mezclada que chocaban al arreglarlas.', quedan;
  else
    raise notice 'Todas las identidades quedan coherentes.';
  end if;
end $$;
