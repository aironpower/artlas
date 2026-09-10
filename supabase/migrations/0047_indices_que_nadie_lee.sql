-- ============================================================================
-- Artlas · 0047 — tirar los índices que nadie lee
--
-- Medido el 3 de septiembre de 2026 contra `pg_stat_user_indexes`, con las
-- estadísticas acumuladas desde el 20 de agosto: dos semanas y media que
-- incluyen ingestas, barridos del panel y el tráfico real de la web.
--
-- El dato que ordena la decisión no es el tamaño de la base, son sus mitades:
-- de los 406,6 MB, **~200 MB son tablas y ~207 MB son índices**. Pagamos más
-- por buscar que por guardar. Y cuatro de esos índices tienen `idx_scan = 0`:
--
--   artworks_title_trgm             25    MB   (25 MB)
--   artworks_inventory_idx           9,45 MB   (9680 kB)
--   artworks_slug_idx                8,87 MB   (9080 kB)
--   artist_translations_name_trgm    3,27 MB   (3344 kB)
--                                   ----------
--                                    46,6 MB   →  de 81,3% a 72,0% del plan
--
-- Los kB de `pg_size_pretty` son de 1024, no de 1000: leerlos como decimales
-- infla el ahorro medio megabyte. Entre paréntesis va lo que dijo Postgres.
--
-- Ninguno es primario ni único: tirarlos no deja de garantizar nada. Y el
-- espacio de un índice vuelve al soltarlo, sin esperar al autovacuum — no es
-- el caso de las filas muertas, que ocupan hasta que alguien las barre.
--
-- POR QUÉ NO `DROP INDEX CONCURRENTLY`, que evitaría el bloqueo: no puede
-- correr dentro de una transacción, y `migrate.ts` envuelve cada migración en
-- una. Sería exactamente el fallo silencioso de la 0009. Así que esta migración
-- **pide ingesta parada**: un `drop index` normal toma un bloqueo exclusivo
-- breve sobre `artworks`, y con escrituras vivas se pone a la cola detrás de
-- ellas. Comprobar antes que no hay ningún `cli.ts` corriendo.
-- ============================================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- El grande, y el más discutido
--
-- La 0009 lo hizo parcial sobre `published` para que las obras pendientes no
-- pagaran un GIN que no iban a usar. El efecto fue el contrario del buscado:
-- quien busca por título en la web va contra las traducciones
-- (`artwork_translations_title_trgm`) y quien corrige en el panel busca
-- precisamente entre las pendientes, que es lo único que este índice NO cubre.
-- La 0031 ya lo dejó escrito —«el índice no le servía»— y la 0044 llegó a
-- decir lo contrario por descuido: buscar dentro del radio tira de
-- `artists_name_trgm`, no de aquí.
--
-- Esto NO cierra la puerta que sigue abierta en NOTAS. Si algún día se quiere
-- corregir por título las 134.000 que esperan datos, el índice completo son
-- ~40 MB y se crea entonces, con el hueco ya recuperado. Lo que no tiene
-- defensa es seguir pagando 25 MB por la versión que no sirve a ninguno de los
-- dos casos.
-- ----------------------------------------------------------------------------
drop index if exists artworks_title_trgm;

-- ----------------------------------------------------------------------------
-- El cruce que acabó haciéndose en memoria
--
-- La 0017 lo creó como «clave de cruce con la API del museo». El cruce existe
-- y funciona, pero `fill-images.ts` lo resuelve en JavaScript: se trae el
-- catálogo del museo, monta un Map por número normalizado y empareja ahí. A la
-- base no le llega ninguna consulta por `(institution_id, inventario)`, y por
-- eso el contador está en cero después de varias ingestas.
--
-- Si algún día el cruce se hace por SQL, la línea de la 0017 se vuelve a
-- pegar tal cual.
-- ----------------------------------------------------------------------------
drop index if exists artworks_inventory_idx;

-- ----------------------------------------------------------------------------
-- Un índice para una URL que no existe
--
-- Las obras se sirven por `/obra/[id]`, no por slug. El slug se lee de la fila
-- para pintar el enlace, pero nunca se busca POR él: ni la web, ni la ingesta
-- —que sí resuelve por slug los artistas y los movimientos, y por eso aquellos
-- índices sí se usan—. Es un índice heredado de la 0001 que la 0009 se limitó
-- a encoger cuando ya entonces no lo consultaba nadie.
--
-- No es único, así que no impedía slugs repetidos: soltarlo no cambia ninguna
-- garantía.
-- ----------------------------------------------------------------------------
drop index if exists artworks_slug_idx;

-- ----------------------------------------------------------------------------
-- El trigrama duplicado
--
-- Buscar un artista pasa por `artists_name_trgm` (1.932 lecturas en la
-- ventana). La variante sobre las traducciones no la ha tocado nadie: los
-- nombres de persona no se traducen casi nunca, así que la tabla original ya
-- responde por todos los idiomas.
-- ----------------------------------------------------------------------------
drop index if exists artist_translations_name_trgm;

-- ----------------------------------------------------------------------------
-- Lo que queda vigilado
--
-- `artwork_translations_title_trgm` son 15 MB para 3 lecturas en la ventana.
-- No se tira aquí porque esas 3 son el buscador de la web funcionando: es el
-- camino correcto, solo que poco transitado. Si al repetir la medida sigue en
-- unidades, la pregunta ya no es el índice sino por qué nadie busca.
-- ----------------------------------------------------------------------------
