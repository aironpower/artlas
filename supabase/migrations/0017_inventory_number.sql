-- ============================================================================
-- Artlas · 0017 — el número de inventario del museo
--
-- Es la única clave con la que se puede cruzar una obra nuestra con la API de
-- su museo. Por título no se puede: el Nationalmuseum cataloga en sueco
-- ("Landskap med pinjer") y nosotros guardamos la etiqueta inglesa de Wikidata.
--
-- Medido en su catálogo: el 95% de sus 208.334 objetos tiene número de
-- inventario y el 51% tiene además imagen. Wikidata publica ese mismo número
-- en P217 ("NMB 1723", "NMH 1143/1924"), con el mismo formato.
--
-- Sin esta columna, `fill-images` tiene que preguntarle a Wikidata el
-- inventario de cada obra cada vez que se ejecuta: 23.214 QID en lotes de 200
-- son 116 consultas a WDQS que no hacen falta si el dato ya está guardado.
-- ============================================================================

set search_path = public, extensions;

alter table artworks
  add column if not exists inventory_number text;

comment on column artworks.inventory_number is
  'Número de inventario del museo (Wikidata P217). Clave de cruce con la API del museo.';

-- Normalizado, que es como se compara: "NMB 1723" y "nmb1723" son el mismo
-- objeto. Se indexa la expresión para poder cruzar sin recorrer la tabla.
create index if not exists artworks_inventory_idx
  on artworks (institution_id, upper(replace(inventory_number, ' ', '')))
  where inventory_number is not null;
