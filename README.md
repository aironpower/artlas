# Artlas

Mapa mundial de obras de arte. Un catálogo de las obras más importantes del
mundo, geolocalizadas en el museo donde se exponen, filtrable por autor,
movimiento, año y categoría, con valoraciones de usuarios sobre obras y museos.

El proyecto son dos aplicaciones sobre una misma base de datos:

- **Ingesta** (`packages/ingest`) — construye el catálogo a partir de APIs
  públicas de museos y de Wikidata. Es una herramienta de línea de comandos.
- **Web** (`apps/web`) — la app que usan los visitantes: mapa mundial,
  buscador con filtros, fichas de obra y de museo, "obras cerca de mí".

El estado al cerrar cada sesión y lo pendiente están en [NOTAS.md](NOTAS.md).

Estado: **funcionando de punta a punta**, con ~114.000 obras de 48 museos.
Trilingüe (español, inglés y francés), ingesta verificada contra las APIs
reales, app web con mapa, buscador, fichas de obra, museo y artista, y un
panel de revisión para administradores.

---

## Por qué el catálogo se construye así

La decisión de fondo es que **Wikidata es la espina dorsal y las APIs de los
museos solo enriquecen**. No es lo que parecía obvio al principio, así que
conviene explicar el porqué.

Las APIs de museo (Art Institute of Chicago, The Met, Harvard) tienen
metadatos excelentes, pero cada una cubre **una sola institución**. Un mapa
construido solo con ellas tendría tres chinchetas. Wikidata es la única fuente
que relaciona obras con museos de todo el mundo **y da coordenadas**, que es
justo lo que convierte esto en un mapa y no en un listado.

A cambio, Wikidata tiene imágenes mediocres y fichas incompletas. De ahí el
reparto: Wikidata aporta cobertura, geografía, movimiento artístico y
notoriedad; las APIs de museo aportan imagen en alta resolución (IIIF), técnica
catalogada, dimensiones y hasta el número de sala.

## Lo que costó descubrir

Estas ocho cosas se midieron contra los endpoints reales, y cada una cambió
el diseño. Están anotadas también en el código, junto a los sitios donde
importan.

**1. Toda consulta a Wikidata va acotada por museo.** El endpoint público corta
a los 60 s. Pedir "todas las pinturas con ubicación y coordenadas" da timeout;
la misma consulta acotada a un museo tarda 1,1 s. No hay consulta global que
sobreviva, ni siquiera un `COUNT`.

**2. Las obras no cuelgan del museo, cuelgan de sus departamentos.** Hay dos
propiedades en uso (`P195` colección y `P276` ubicación) y los museos grandes
usan sub-entidades. Medido:

| Museo | Vía `P195` | Vía `P276` | Vía hijos `P361` |
|---|---|---|---|
| Louvre | 4 | 71 | **4.692** |
| Prado | 3.969 | — | — |
| Met | 8.787 | — | — |

Sin expandir el árbol de sub-entidades, el Louvre aparecería vacío en el mapa.

**3. Enumerar e hidratar son dos consultas, no una.** Pedir los metadatos
(autor, fecha, movimiento, dimensiones) en la misma consulta que recorre la
colección vuelve a dar timeout aunque esté acotada por museo. Separadas:
5 s para listar los identificadores + 1,3 s por lote de 50 al hidratarlos.

**4. `FILTER(lang(?label) = "es")` pierde datos en silencio.** Deja la Gioconda
sin autor y el San Francisco de Giotto sin título, porque descarta las
entidades que solo tienen etiqueta inglesa. Hay que usar el `wikibase:label`
service, que aplica fallback `es → en`.

**5. La búsqueda de entidades de Wikidata es por prefijo, no difusa.** Buscar
`Musée Picasso Paris` no devuelve nada; `Musee Picasso` devuelve `Q743206`.
Los nombres que uno escribe de forma natural, con la ciudad como
desambiguador, son justo los que fallan. `build-seed.ts` prueba el nombre
completo y va quitando palabras por el final hasta que alguna coincide.

**6. Los textos son una TERCERA consulta, aparte de los escalares.** Al pasar
el catálogo a multilingüe, pedir los siete idiomas dentro de la hidratación
—con un `OPTIONAL` + `GROUP_CONCAT` por campo traducible— daba 504 con solo 12
obras. Cada `OPTIONAL` multiplica las filas por idioma *antes* de agregar:
7 idiomas × 5 campos son hasta 7⁵ combinaciones por obra. La solución es una
consulta plana que no agrega nada y devuelve una fila por (entidad, idioma):
150 entidades × 7 idiomas en 1,06 s.

El patrón se repitió tres veces: **cuando SPARQL va lento, la respuesta es
partir la consulta, no optimizarla.**

**7. Wikimedia bloquea el hotlinking de imágenes originales.** Las URLs que da
Wikidata (`Special:FilePath`) devuelven 429 con un mensaje que pide usar
miniaturas, y su cadena de redirecciones pasa por respuestas `text/html` con
`nosniff` que el navegador descarta por ORB (`ERR_BLOCKED_BY_ORB`). Hay que
construir la URL directa de la miniatura a partir del MD5 del nombre de
fichero — y solo con anchos concretos: 250, 500 y 1280 funcionan, 1000 y 1500
devuelven 400. Todo eso vive en `apps/web/lib/images.ts`.

**8. Un rectángulo `geography` que abarca los 360° de longitud es degenerado.**
`institutions_in_bbox` usaba `st_intersects` sobre `geography`, donde los lados
de un polígono son arcos de círculo máximo. El mapa mundial salía vacío, sin
ningún error: bbox −180..180 daba 0 museos mientras que −10..30 daba 6. Se
arregla comparando cajas en el plano con `&&` sobre `geometry`, que para puntos
equivale a la intersección exacta y además usa índice.

## Guardar todo, mostrar lo que se pueda

El catálogo empezó siendo curado —solo obras con varias Wikipedias detrás— y
dejó de serlo cuando quedó claro lo que eso descartaba. Medido contra Wikidata:
en nuestros 48 museos existen 182.382 obras y el catálogo curado tenía 6.161,
un 3,4%. Y lo que faltaba no era basura: era obra real sin foto en Wikimedia
Commons, que para el arte del siglo XX es sencillamente obra en derechos.

Así que ahora se guarda todo y una columna dice qué es visible:

| `artworks.status` | Qué significa |
|---|---|
| `published` | Se puede enseñar hoy: tiene imagen, museo y pasa las reglas. |
| `pending` | Existe y es real, pero le falta algo. Espera en la base. |
| `rejected` | Está probado que no es una obra de arte. |

La distinción entre `pending` y `rejected` es la que hay que defender en cada
regla nueva: **«le falta un dato» nunca es `rejected`**. Un cuadro del Reina
Sofía sin imagen espera; solo se rechaza lo que se demuestra que no es una obra
—una chincheta de Google Maps colada como escultura, un título que quedó sin
resolver y es una URL—.

`--min-notability` sigue existiendo y sigue midiéndose con `npm run estimate`,
pero ya no decide qué entra: decide qué se enumera primero. El barrido completo
se lanza con `--everything`, que no filtra por notoriedad ni exige imagen.

**Un solo criterio, tres momentos.** Las reglas viven en `audit/rules.ts` como
funciones puras y las usan el auditor (sobre lo que ya está dentro), la puerta
de entrada (sobre lo que llega) y `promote` (sobre lo que cambió). Escribir una
segunda versión de una regla es garantizar que un día digan cosas distintas.

---

## Derechos de autor

Se heredan, no se deducen. Por orden de autoridad:

1. Lo que **declara Wikidata** en `P6216`. Lo dice el 76% de las obras.
2. La regla de los **70 años** desde la muerte del autor, calculada con el año
   en curso: el catálogo se libera solo cada 1 de enero.
3. `unknown`, que se trata como si estuviera en derechos.

Ese orden salió de una equivocación. Deduciendo por fecha de muerte, las 49
obras "en derechos" del catálogo eran Hopper, Warhol y Chagall… con la imagen
alojada en Wikimedia Commons, que solo admite contenido libre. La fuente decía
una cosa y la deducción otra.

De ahí la distinción que gobierna la interfaz: **los derechos de la OBRA y la
licencia del FICHERO son cosas distintas**, y lo que decide si se puede pintar
un `<img>` es la segunda. `image_mode()` lo resuelve en SQL —`full`,
`thumbnail` o `none`— y la web obedece en un solo componente. Cambiar la
política es cambiar esa función, no repasar la app buscando dónde se pinta una
imagen.

---

## Cómo funciona el multilingüe

Los datos neutros (año, medidas, imagen, coordenadas) viven en las tablas
principales; los textos, en tablas de traducción con una fila por idioma.

La razón de fondo para elegir tablas y no un JSONB con todos los idiomas
dentro es **la búsqueda**. Postgres necesita un diccionario distinto por lengua
para lematizar, y con una fila por idioma cada una lleva su `tsvector`
construido con el suyo. El resultado se nota:

```
"retratos" [es] -> encuentra "Retrato de Giovanna Tornabuoni"
"portraits" [en] -> encuentra "Portrait of Giovanna Tornabuoni"
"gemälde"  [de] -> encuentra "Der zwölfjährige Jesus unter den Schriftgelehrten"
```

Se traducen también los nombres propios, que no es un detalle menor:
*Albrecht Dürer* → *Alberto Durero*, *Museo del Louvre* → *Louvre Museum*,
*posimpresionismo* → *Post-Impressionism*.

La cadena de respaldo —idioma pedido → inglés → lo que haya → valor neutro—
vive **en SQL**, dentro de las funciones RPC. Si cada pantalla la implementara
por su cuenta, acabarían comportándose distinto entre ellas.

Un matiz sutil del conector, anotado también en el código: se usa el
`wikibase:label` service para el **valor neutro de respaldo**, pero las
traducciones vienen de `rdfs:label` filtrado por idioma. Son dos mecanismos
distintos y confundirlos es justo lo que dejó la primera versión del catálogo
con el 61% de los títulos en inglés dentro de una columna que parecía española.

## Puesta en marcha

### 1. Base de datos

Crea un proyecto en [Supabase](https://supabase.com), pon la cadena de
conexión en `DATABASE_URL` (panel: *Connect > Session pooler > URI*) y aplica
las migraciones:

```bash
cd packages/ingest
npm run migrate -- --status     # qué hay aplicado y qué falta
npm run migrate -- --dry-run    # las ejecuta y hace ROLLBACK: ¿funcionarían?
npm run migrate                 # aplicarlas
```

**Usa el *Session pooler*, no la conexión directa**: `db.<ref>.supabase.co`
solo resuelve por IPv6 y falla con `ENOTFOUND` en redes sin IPv6.

`supabase db push` no vale aquí: la CLI espera nombres con marca de tiempo y
lleva su propia cuenta, mientras que estas migraciones van numeradas y las
primeras se aplicaron a mano. `npm run migrate` lleva su registro en
`applied_migrations` y nunca reaplica.

El `--dry-run` no es un lujo: `create or replace function` **no puede cambiar
el tipo de retorno** de una función existente, y como el editor SQL de Supabase
envuelve el script en una transacción, ese error tumba la migración entera en
silencio — parece que fue bien y no se aplicó nada. Ensayar lo caza en dos
segundos.

Las migraciones crean el esquema, los índices (parciales sobre lo publicado),
la búsqueda full-text con tolerancia a acentos, las políticas de seguridad por
fila, el modelo de derechos y las funciones RPC que la app usa
constantemente.

### 2. Credenciales

```bash
cp .env.example .env
```

Rellena `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, y pon tu contacto real
en `WIKIDATA_USER_AGENT` — Wikidata limita agresivamente a quien no se
identifica. AIC y el Met no necesitan clave; Harvard sí (registro gratuito).

### 3. Semilla de museos

```bash
cd packages/ingest
npm run seed
```

Resuelve cada museo por nombre contra Wikidata, comprueba que tiene
coordenadas y estima cuántas obras notables aporta. Existe para que un QID
equivocado falle de forma visible: un QID mal escrito no da error, simplemente
devuelve cero obras y el museo desaparece del mapa sin que nadie se entere.

Para añadir museos, añade su nombre a `CANDIDATES` en ese script y vuelve a
ejecutarlo.

### 4. App web

```bash
cd apps/web
npm run dev          # desarrollo en localhost:3000
npm run build && npm start
```

Necesita `NEXT_PUBLIC_SUPABASE_ANON_KEY` en el `.env` de la raíz — la clave
**anon**, no la `service_role`: va al navegador y está limitada por RLS.

### 5. Ingesta

```bash
# Primero en seco, sin escribir nada y sin necesitar Supabase
npm run ingest -- --dry-run --museum Q160112

# El catálogo curado completo
npm run ingest -- --all

# Solo lo muy célebre
npm run ingest -- --all --min-notability 15
```

La ingesta guarda un checkpoint por museo en `.checkpoints/`, así que se puede
interrumpir y reanudar. Es una operación de horas contra APIs de terceros y no
debe empezar de cero cada vez que se cae la red.

```
npm run ingest -- --help
```

### Comprobaciones

```bash
npm run check-db     # esquema, credenciales y espacio ocupado
npm run check-gate   # el clasificador de entrada, sin red ni base de datos
npm run check-perf   # ¿responden las consultas de la app dentro del límite?
npm run verify       # ¿siguen respondiendo las APIs como esperamos?
npm run estimate     # ¿cuántas obras da cada umbral de notoriedad?
npm run peek         # ¿qué hay en el catálogo ahora mismo?
```

`check-perf` usa la **clave anónima**, la misma que el navegador, y no la
`service_role`. Es deliberado: el rol `anon` tiene `statement_timeout = 3s` y
la service_role no, así que medir con la cómoda daba todo por bueno mientras la
web devolvía 500. Existe porque al pasar de 6.000 a 114.000 obras dos consultas
se rompieron sin que ningún typecheck ni ningún build lo dijera.

`check-gate` no toca la red ni la base: las reglas son funciones puras y los
casos son defectos que aparecieron de verdad en el catálogo.

### Mantenimiento del catálogo

```bash
npm run audit -- --images    # audita; las imágenes en pasadas de 800
npm run promote              # reclasifica lo que ya está dentro
npm run fill-images          # busca imágenes en la API del museo
npm run merge-movements      # fusiona movimientos duplicados
```

**Todas enseñan lo que harían y no escriben** hasta que se les pasa `--apply`.
Casi todas mueven o borran filas, así que el modo seco es el comportamiento por
defecto y no una opción.

`verify` llama a las APIs reales, no es un test unitario. Existe para responder
rápido a "¿esto se ha roto por mi cambio o porque Wikidata cambió algo?", que
con cuatro fuentes externas es una pregunta constante. Incluye un control
negativo: comprueba que AIC **rechaza** el "Wheatfield" de Braque cuando se le
pide un Van Gogh que no tiene.

---

## Estructura

```
artlas/
├── supabase/migrations/     Esquema PostGIS, índices, RLS y funciones RPC
├── packages/ingest/
│   ├── src/
│   │   ├── cli.ts               Línea de comandos
│   │   ├── pipeline.ts          Orquestación, checkpoints, deduplicación
│   │   ├── build-seed.ts        Verificación de museos contra Wikidata
│   │   ├── verify-sources.ts    Comprobación de las APIs externas
│   │   ├── estimate.ts          Tamaño del catálogo por umbral
│   │   ├── check-db.ts          Verificación del esquema en Supabase
│   │   ├── peek.ts              Vistazo al catálogo ingerido
│   │   ├── normalize.ts         Slugs, huellas de deduplicación, fusión
│   │   ├── db.ts                Escritura a Supabase, caché de ids
│   │   ├── types.ts             Modelo canónico
│   │   ├── sources/
│   │   │   ├── wikidata.ts      Espina dorsal: cobertura y geografía
│   │   │   └── museum-apis.ts   Enriquecimiento: Met y AIC
│   │   └── util/http.ts         Reintentos, backoff, rate limiting
│   └── data/museums.seed.json   Generado, no editar a mano
└── apps/web/
    ├── app/[lang]/          Rutas por idioma: mapa, buscador, obra, museo
    ├── app/api/cerca/       Consulta geográfica (reescribe URLs de imagen)
    ├── components/          Mapa, rejilla, buscador, "cerca de mí"
    └── lib/
        ├── data.ts          Acceso al catálogo vía RPC
        ├── i18n.ts          Idiomas y textos de interfaz
        └── images.ts        URLs de miniatura de Wikimedia
```

## Modelo de datos

Una **obra** la hizo un **artista**, pertenece a uno o varios **movimientos** y
se expone en una **institución**, que está en un punto del mapa. Los usuarios
puntúan obras e instituciones y marcan visitas.

Dos decisiones que se salen de lo evidente:

**Las obras guardan una copia de las coordenadas de su museo.** Es
denormalización deliberada: el mapa filtra el catálogo entero por *bounding
box* en cada movimiento del usuario, y hacer un join a `institutions` en cada
tesela sería el cuello de botella de toda la aplicación.

**Las fechas son un rango, no un año.** En arte lo normal es "c. 1503-1519".
Guardar un único año obligaría a inventarse una precisión que las fuentes no
tienen y rompería el filtro por periodo.

## Deduplicación

La misma obra llega por varios caminos: Wikidata la tiene como `Q18689458` y la
API del Met como objeto `436535`. Hay dos mecanismos:

- **Exacto por QID.** El Met publica `objectWikidata_URL` en cada objeto, así
  que el cruce es inequívoco.
- **Heurístico por huella** `(título + autor + década)` cuando no hay QID, que
  es el caso de AIC. El año se redondea a década a propósito: las fuentes
  discrepan constantemente en la datación exacta y exigir el año roto casi
  todos los emparejamientos reales.

Al fusionar, cada campo lo gana la fuente de mayor rango que lo tenga relleno,
de modo que un dato ausente nunca pisa a uno presente. Las APIs de museo ganan
en los datos del objeto (técnica, dimensiones, imagen); Wikidata gana en lo
contextual (movimiento, notoriedad, geografía).

Ojo con la búsqueda de AIC: es difusa y alegre. Buscando "Wheat Field with
Cypresses" devuelve como primer resultado un "Wheatfield" de Braque. Por eso
el emparejamiento exige que coincida el autor **y** además el título o el año.

## Licencias

Los datos de Wikidata son CC0. Las imágenes vienen de Wikimedia Commons y de
las APIs de los museos, con licencias que varían por obra: el campo
`image_license` guarda la de cada una y la app debe mostrarla. AIC y el Met
marcan explícitamente qué obras son de dominio público.
