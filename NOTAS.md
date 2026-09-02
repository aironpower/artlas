# Notas de trabajo

Estado de Artlas al **2 de septiembre de 2026** y lo siguiente a hacer.

**Aquí solo vive lo que sigue siendo verdad hoy.** La crónica de lo ya hecho
—con el porqué de cada decisión y lo que se aprendió rompiéndola— está en
[HISTORIAL.md](HISTORIAL.md), del día más reciente al más antiguo.

Ese reparto se hizo el 2 de septiembre, con el fichero en 1.935 líneas, porque
mezclar las dos cosas ya había pasado factura: tres tareas hechas seguían
escritas como pendientes y hubo que añadir una nota diciendo «fiarse de las
secciones HECHO, que llevan fecha». **Una tarea que se termina se borra de aquí
y se cuenta allí.**

---

## AL EMPEZAR

Cifras **comprobadas contra la base el 2 de septiembre**, no heredadas de la
sesión anterior (`npm run check-db`, `migrate -- --status` y una consulta
directa de estados):

| | |
|---|---|
| Obras | 269.159 · **135.258 publicadas**, 133.899 esperando datos, 2 rechazadas |
| Imágenes | 135.258 verificadas · **0 rotas, 0 sin comprobar, 0 publicadas sin imagen** |
| Artistas | 21.619 en la tabla · **11.426 con obra publicada** |
| Museos | **48 de 48**, en 34 ciudades |
| Movimientos | 224 en la tabla · 186 con obra publicada |
| Hallazgos abiertos | 43 (de 344; los otros 301 ya revisados) |
| Migraciones | `0001`–`0042` · **42 aplicadas, 0 pendientes** |
| Espacio | **406,5 MB** de los 500 del plan gratuito (81,3%) |

**Lo primero, siempre: comprobar que no hay nada corriendo.** Tocar el catálogo
con una ingesta viva ya tumbó un museo entero. En PowerShell,
`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"` y mirar si alguna
línea de comandos lleva `cli.ts`.

**Ojo al espacio antes de meter un museo grande.** A ~0,89 KB por obra quedan
unas 105.000 de margen. Y **desconfiar de lo que crece sin ser el catálogo**: el
susto de agosto —495 MB, el 99% del plan— no fueron las obras, fue una tabla
derivada que guardaba una fila por obra para repetir lo que la obra ya decía.
`check-db` lo desglosa tabla a tabla.

Y ojo con leer una subida como si fuera catálogo nuevo: reescribir 135.000 filas
—marcarles `image_checked_at`, por ejemplo— deja filas muertas que ocupan hasta
que el autovacuum las devuelve. Si urge, `vacuum full artworks`, que necesita
hueco libre del tamaño de la tabla.

---

## Lo que queda por hacer

### 1. La ingesta de museos, delegable

El panel `/es/admin/ingesta` ya pide trabajos y los sigue, pero **no sirve
todavía para añadir un museo que no esté en la semilla**, que es justo lo que
haría falta para que esto lo pudiera hacer otra persona. Dos huecos concretos:

- **`cli.ts` filtra `data/museums.seed.json` por QID**, así que un museo nuevo
  muere con «Ningún museo coincide». El formulario dice «Añadir o actualizar un
  museo» y hoy solo actualiza. La pieza que falta ya existe:
  `fetchInstitution(qid)` en `sources/wikidata.ts` trae nombre, coordenadas,
  ciudad, país y web en los tres idiomas. Lo que hay que decidir es que **la
  lista de museos deje de ser un fichero del repo**: mientras sea un JSON
  versionado, añadir un museo es un commit, y eso no se delega.
- **El panel no dice si hay trabajador escuchando.** Solo enseña «Última señal»
  cuando ya hay una ingesta corriendo, así que quien pulse con el trabajador
  apagado ve su encargo en cola sin ninguna explicación.

Y una tercera cosa que no es código: **un museo nuevo no está hecho cuando acaba
la ingesta**, sino cuando alguien repasa su ficha en `/es/admin/catalogo`
—ciudad, país, nombre en es/en/fr—. Para delegarlo, eso tiene que ser una lista
guiada en pantalla y no algo que sepa solo Manuel.

### 2. Cabos conocidos, de un rato cada uno

- **Las obras que cambian solas.** Unas 4.500 del catálogo declaran varios
  valores para la misma propiedad en Wikidata (dos materiales, dos fechas) y
  SPARQL no garantiza el orden, así que la ingesta se queda con uno u otro en
  cada pasada. Se arregla **ordenando los valores antes de elegir**, como ya se
  hizo con las fechas de los movimientos. Coste conocido y acotado, no una fuga.
- **`artworks_title_trgm`: 25 MB y `idx_scan = 0`.** Es parcial —solo
  publicadas— y por eso no lo usa nadie; corregir por título no llega a las
  obras que esperan datos. Cambiarlo por uno completo son ~40 MB. No se hizo en
  su momento porque había una ingesta de 121.000 obras escribiendo.
- **Buscar y la lista de artistas siguen con botón de paginación**, mientras que
  la ficha de museo ya sigue sola al llegar abajo.
- **El esqueleto de `loading.tsx` no se sustituye nunca sin JavaScript.** Es del
  streaming de Next, no nuestro, pero deja dos rejillas en el HTML.
- **Los cuatro idiomas fantasma de `i18n.ts`** (it, de, pt, nl): el fichero dice
  que están completos y les faltan 7 claves a cada uno. Nadie se entera porque
  `UIKey` sale de `es` y TypeScript no mira esos bloques. **Pendiente de decidir
  si se borran.**
- **Reanudar sola dentro de un museo.** El checkpoint es por museo: al reanudar
  se rehace entero. Con la ingesta incremental ya es barato, así que urge menos.
- **`ingest_runs`, `ingest_steps` y `jobs` no se borran nunca.** Son diminutas
  —unas 48 filas por barrido—; si algún día molestan, la retención es trivial.

### 3. Decisiones de Manuel, no trabajo

- **¿Puede registrarse cualquiera?** Hoy sí: con un correo válido se crea perfil
  `viewer`, que no da ningún permiso. Si no se quiere, se cierra el registro
  desde Supabase.
- **Las nacionalidades** salen de Wikidata en inglés y sin traducir —«Tang
  dynasty», «Kingdom of Pergamon»—, y muchas son estados que ya no existen.
- **El buscador no filtra por museo concreto**; por ciudad sí.
- **El SMTP de serie de Supabase manda 2-3 correos por hora.** Para usuarios de
  verdad hace falta uno propio (Resend, Postmark); hasta entonces, el segundo
  registro de la hora ve «no hemos podido enviar el correo».
- **Nominatim y las teselas del mapa son terceros sin contrato.**

---

## Cómo se lanza cada cosa

### Comprobar al retomar

```bash
cd packages/ingest
npm run migrate -- --status   # ¿hay migraciones sin aplicar?
npm run check-db              # esquema, credenciales y espacio ocupado
npm run check-gate            # el clasificador de entrada, sin red ni base
npm run check-perf            # ¿responden las consultas de la app? (clave anon)
npm run peek                  # qué hay en el catálogo
```

Requiere **Node 22**. Si `node -v` dice 16, es el del PATH de Windows; el bueno
está en `%APPDATA%/nvm/v22.12.0`.

### El panel, y el trabajador que lo hace todo

Doble clic en `trabajador.cmd` y déjalo abierto. Desde `/es/admin/ingesta` se
piden los trabajos —añadir o actualizar un museo, barrido completo, buscar
imágenes, publicar, auditar, recalcular contadores, comprobar la base—, se ven
en cola y en curso con sus últimas líneas de salida en vivo, y se pueden parar.

**El reparto, que es la decisión de fondo:** la web **encarga** (tabla `jobs`),
la máquina de casa **ejecuta** y el panel enseña lo que pasa. Un barrido dura
horas y Vercel corta las funciones a segundos; alojar algo que aguante horas
cuesta dinero, y el plan gratuito es una restricción del proyecto. Si no hay
trabajador escuchando, el encargo espera; no se pierde.

**La regla de seguridad, que no se puede relajar:** `kind` es una lista cerrada
en la propia tabla y los argumentos son **datos, nunca una orden**. El trabajador
traduce cada `kind` a un comando fijo que él conoce y valida cada argumento
contra lo que espera. Sin eso, un formulario web sería un intérprete de comandos.

Y dos cosas que se aprendieron a base de romperlas: **se lanza `node`
directamente, no `npm`** —en Windows `npm` es un `.cmd` que abre un `cmd.exe`
que abre el `node`, y matar el envoltorio deja al nieto vivo y escribiendo en el
catálogo—; y **parar es pedirlo, no matarlo**: a la ingesta se le levanta la
bandera y sale entre museos, porque cortar uno a la mitad lo deja sin checkpoint.

Para ver el panel sin esperar un correo:

```bash
cd apps/web && npx next dev -p 3111
node apps/web/scripts/ver-panel.mjs /es/admin/ingesta salida.png
```

`ver-panel.mjs` emite el mismo token que emitiría el correo, lo canjea y escribe
la cookie con el propio código de `@supabase/ssr`. La página sigue leyendo con la
sesión y sujeta a las políticas: es el camino del usuario, no un atajo. Desde Git
Bash hace falta `MSYS_NO_PATHCONV=1` delante, o convierte `/es/...` en una ruta
de Windows.

### El barrido completo, a mano

La forma que funciona es lanzarlo directamente, sin PowerShell de por medio:

```
cmd /c "chcp 65001 >nul & set PATH=%APPDATA%\nvm\v22.12.0;%PATH% & cd /d C:\projects\artlas\packages\ingest & npm run start -- --all --everything >> C:\projects\artlas\ingesta.log 2>&1"
```

Antes, comprobar las migraciones y que no hay ingesta viva. Dura ~10 h y es
reanudable: los museos con checkpoint se saltan solos.

Cómo acabó se mira en el panel, que para eso existe; y en el log, si hace falta
el detalle:

```bash
tail -40 ingesta.log
grep -E "✗|lote perdido|INCOMPLETO|Obras perdidas" ingesta.log
```

**Un cabo pequeño y conocido**: la Galería Nacional de Canadá (`Q1068063`) y la
Galería de la Academia de Florencia (`Q10855544`) tienen el checkpoint al umbral
de notoriedad 2 en vez de al 0, de unas pruebas del 29 de agosto. No se ha
perdido ninguna obra y el próximo `--all --everything` las rehará: es el
comportamiento correcto y no hay que tocar nada.

### Refrescar un museo

`--force` ya era «rehaz este museo», y desde la ingesta incremental es barato:
de 300 obras del Prado se reescribieron 5.

```bash
cd packages/ingest
npm run start -- --museum Q160112 --everything --force
npm run check-incremental                # la lógica, sin red ni base
```

**Ojo con `--limit` en una pasada de prueba**: escribe el checkpoint con las
obras que haya procesado, así que `--limit 300` marcaría el Prado como completo
con 300 obras y el siguiente barrido se lo saltaría. Si se usa, copiar antes
`.checkpoints/<QID>.json` y devolverlo después. Y `--limit` por `npm run` **no
llega al script**: hay que llamar a `npx tsx src/cli.ts` directamente.

### La cadena de las imágenes

```bash
cd packages/ingest
npm run fill-images                # en seco: cuántas encontraría
npm run fill-images -- --apply     # rellena, tras comprobar que 20 cargan
npm run promote -- --apply         # publica las que ya cumplen
npm run audit -- --images          # verifica 10.000 por pasada, ~5 min
```

`fill-images` tarda ~30 min y **hoy solo tiene conector para el Nationalmuseum**.
Si se encadena con `promote`, hay que esperar a una línea que solo exista al
ACABAR: la de «obras encontradas con imagen» se imprime ANTES de escribir, y por
eso una vez `promote` corrió cinco minutos antes de tiempo y publicó cero.

### Después de una ingesta que traiga movimientos nuevos

```bash
npm run fill-movement-years -- --apply   # idempotente, cuesta segundos
```

---
## Herramientas

| Comando | Para qué |
|---|---|
| `npm run migrate` | Aplica migraciones. `--dry-run` las ejecuta y hace ROLLBACK. |
| `npm run start -- --all --everything` | Barrido completo (~10 h, reanudable). |
| `npm run audit -- --images` | Audita el catálogo. Imágenes de 10.000 en 10.000, preguntando a Commons por lotes de 50. |
| `npm run promote` | Reclasifica lo que ya está dentro. |
| `npm run fill-images` | Busca imágenes en la API del museo. |
| `npm run merge-movements` | Fusiona movimientos duplicados. |
| `npm run check-*` | Comprobaciones. |
| `node apps/web/scripts/ver-panel.mjs <ruta> <png>` | Abre el panel con sesión de administrador. |

**Todas escriben solo con `--apply`** (o aplican solo sin `--dry-run`, en el
caso de `migrate`). Es deliberado: casi todas mueven o borran filas.

---

## Las tres ideas que sostienen el diseño

**1. Guardar todo, mostrar lo que se pueda.** `artworks.status` vale
`published`, `pending` o `rejected`. La distinción que hay que defender en cada
regla nueva: *«le falta un dato» nunca es `rejected`*. Una obra sin imagen
espera; solo se rechaza lo que está probado que no es una obra de arte.

**2. Un solo criterio, tres momentos.** Las reglas de `audit/rules.ts` son
funciones puras y las usan el auditor (sobre lo que ya está dentro), la puerta
de entrada (sobre lo que llega) y `promote` (sobre lo que cambió). Escribir una
segunda versión de una regla es garantizar que un día digan cosas distintas.

**3. Los derechos se heredan, no se deducen.** Por orden: lo que declara
Wikidata en `P6216` (lo dice el 76% de las obras), luego la regla de los 70
años desde la muerte del autor, y si no, `unknown`, que se trata como en
derechos. El orden viene de una equivocación: deduciendo por fecha de muerte,
las 49 obras "en derechos" del catálogo eran Hopper, Warhol y Chagall… con la
imagen alojada en Commons, que solo admite contenido libre.

Y una distinción que costó ver: **los derechos de la OBRA y la licencia del
FICHERO son cosas distintas**. Lo que decide si se puede pintar un `<img>` es
la segunda. `image_mode()` mira primero dónde está alojada la imagen.

---

## Medido y descartado (no volver a proponerlo)

Dos tareas que estuvieron semanas en la lista y **se retiraron con la medición
delante**. Están aquí y no en el historial porque su trabajo es impedir que
alguien las vuelva a proponer.

### Europeana NO sirve para esto

Era el plan para el arte en derechos y **no tiene las obras**:

```
  "Guernica" / Picasso:              0 resultados con imagen
  "Nighthawks" / Hopper:             0
  "Persistence of Memory" / Dalí:    0
  "Whaam!" / Lichtenstein:           0
  Warhol en TODA Europeana:         10 imágenes
```

Tiene 36 millones de imágenes, pero su fuerza son bibliotecas, archivos e
instituciones pequeñas. Los grandes museos de arte no ceden a agregadores sus
imágenes en derechos. De nuestros 48 museos, aparecen 2 y con 4 y 3 registros.

Sigue sirviendo para instituciones pequeñas. No para esto.

---

### Los títulos con paréntesis NO hay que tocarlos

Esta tarea llevaba semanas en la lista como «limpiar el ruido de los títulos de
Wikidata, del tipo *El columpio (Goya)*». **Medido el 1 de septiembre de 2026,
haría muchísimo más daño que bien y se retira de la lista.**

Las cifras, sobre las 135.258 publicadas:

| | |
|---|---|
| Títulos que acaban en paréntesis | 8.902 |
| De ellos, con el nombre de su autor dentro —el caso que motivó la tarea— | **6** |
| Obras que quedarían con el título de otra si se les quitara | **2.035** |

Seis. La tarea existía por un ejemplo suelto que resultó ser una rareza, no un
patrón. Y el paréntesis casi nunca es ruido: es información que no está en
ningún otro campo.

```
"Noce de Village (Village Wedding)"          la traducción del título
"St Jude the Apostle (also known as ...)"    el nombre alternativo
"... (from Cropsey Album)"                   la serie a la que pertenece
"Portrait of Gustav Kh. Schele (1759/60-1820)" las fechas del retratado
"... (recto)" / "... (verso)"                LAS DOS CARAS DE LA MISMA HOJA
"... (1st)" / "... (2nd)"                    dos estados del mismo grabado
```

Los dos últimos son los que lo zanjan: **son lo único que distingue una obra de
otra**. Quitarlos dejaría 80 obras llamadas «Page from a Dispersed Kalpa Sutra»
en el mismo museo, 70 «Leaf from a Kalpa Sutra», 53 «Untitled»… y como el `slug`
sale del título, también colisionarían sus URLs.

**La lección, que vale más que la tarea:** el apunte venía de haber visto un
título feo, no de haber contado. Entre «he visto un caso» y «esto es un patrón»
hay una consulta de cinco minutos, y en este caso la diferencia era 6 contra
2.035.

Si algún día se retoma, lo que sí tiene sentido es lo estrecho: quitar el
paréntesis **solo** cuando su contenido es exactamente el nombre del autor de la
obra. Son seis, se arreglan a mano desde el panel y no hace falta código.

---

## Otras cosas pendientes

### Los cinco conectores de imágenes que quedaron aparcados

Cada uno es un conector nuevo (~1-2 h): buscar en la API del museo la obra que
ya tenemos y traerse su foto. Ordenados por obras que desbloquean. Aparcados a
propósito el 28 de agosto de 2026: no bloquean nada de la aplicación, y hacerlos
todos era la cola infinita que impedía avanzar. Se harán de uno en uno, cuando
apetezca.

| Museo | Obras que desbloquea | Cómo está su API |
|---|---|---|
| National Gallery of Victoria | 5.227 | sin comprobar |
| Hermitage | 4.601 | **sin API abierta**; probablemente no se pueda |
| National Gallery of Canada | 3.841 | sin comprobar |
| Harvard Art Museums | 3.492 | API con clave; hay conector de *enriquecimiento*, no de imágenes |
| SMK (Dinamarca) | 2.063 | **abierta y ya probada** — el más fácil, y el que yo haría primero |
| Prado | 2.445 | sin comprobar; 2.268 en dominio público |

Antes de escribir cualquiera de ellos, la sonda de diez minutos: ¿tiene de
verdad esa API la foto de una obra que ya tengamos, cruzada por su número de
inventario? Medir antes de construir.

### Lo demás

- **Valoraciones de usuarios.** Tablas y RLS desde `0001`. **Auth ya está**
  desde el 1 de septiembre: lo único que falta es la interfaz.
- **La técnica sale como soporte.** Wikidata usa `P186` (material), que da
  "lienzo" en vez de "óleo sobre lienzo".
- **La licencia concreta de cada fichero de Commons.** Hoy se guarda
  "Wikimedia Commons" a secas. Traer la licencia real son ~3.650 peticiones a
  su API; solo cambia la línea de atribución.
- **Los 4 idiomas retirados** (it, de, pt, nl). Los textos de interfaz y los
  segmentos de URL siguen escritos: reactivarlos es añadirlos a `LANGS`,
  `LANG_NAMES`, `SEGMENTS` y `LANGUAGES`, y reingerir. Lo que no cabía en 500 MB
  eran sus traducciones de catálogo.

---

## Publicación

**El sitio está en https://artlas.softie.dev desde el 28 de agosto de 2026.**
El código, en https://github.com/aironpower/artlas (privado). Cada push a
`master` publica solo. El proyecto de Vercel se llama `web`, no `artlas`.

Comprobado en producción el día que se subió: las tres portadas, buscador,
museo, artista, obra, «cerca de mí» (60 obras desde el Paseo del Prado) y la
entrada al panel con enlace mágico, que vuelve al dominio y no a localhost.

Los pasos, y los tres atascos que costaron la tarde, en
[DESPLIEGUE.md](DESPLIEGUE.md). No es GitHub Pages y no puede serlo: hacen falta
servidor y 232.491 páginas contra su límite de 1 GB, y desde repo privado además
es de pago.

---

## Tropiezos de método, para no repetirlos

**El ritmo se mide, no se deduce de la configuración.** «Dos peticiones cada
400 ms» dice lo que se PIDE, no lo que el otro lado concede. Se estimaron 12
horas de verificación de imágenes y el ritmo real daba tres días y medio, porque
Wikimedia limita tras once peticiones seguidas. Una muestra de veinte
peticiones, dos minutos, lo habría dicho.

**Desconfiar de lo que crece sin ser el catálogo.** La base llegó al 99% del
plan y no fueron las obras: una tabla derivada guardaba 121 MB para repetir lo
que el catálogo ya decía. Cuando el espacio se dispare, mirar `pg_total_relation_size`
tabla a tabla antes de suponer de dónde viene.

**Una herramienta escrita y nunca ejecutada no está hecha.** El conector de
imágenes llevaba cuatro días dado por bueno y construía todas sus URLs mal.
Nadie lo había corrido ni una vez.

**Un lanzador que falla en silencio es peor que no tener lanzador.**
`reanudar-ingesta.ps1` llevaba dos días sin lanzar un solo barrido y nadie lo
sabía, porque moría sin escribir nada. Se dio por hecho que funcionaba al ver el
proceso arrancar. La comprobación que faltaba costaba diez segundos: mirar si el
log avanza más allá del arranque. El script se borró el 2 de septiembre —seguía
sin diagnosticar del todo— pero sus dos trampas de PowerShell 5.1 valen para
cualquier otro lanzador que se escriba:

1. **`npm … 2>&1` dentro de PowerShell 5.1 envuelve CADA línea de stderr en un
   `ErrorRecord`.** Con `$ErrorActionPreference = 'Stop'` eso es un error
   terminante aunque el comando devuelva 0, y a `migrate` le basta con su aviso
   inofensivo sobre el certificado para matar el script. Que la redirección la
   haga `cmd`, no PowerShell.
2. **`Tee-Object` en 5.1 escribe UTF-16 y no acepta `-Encoding`.** El log salía
   con un byte nulo entre letra y letra, ilegible para `grep` y para `tail`.
   Escribir con `Add-Content -Encoding utf8`.

Por eso `trabajador.cmd` es deliberadamente tonto: `chcp`, el PATH del Node
bueno y un bucle que relanza a los 10 s.

**Contar mal un dato de terceros parece un fallo propio.** Al reparar autores,
el primer recuento decía que 1.662 de cada 2.000 obras «tenían autor y no
sabíamos nombrarlo», que habría sido un filón. Eran autorías con el **valor
desconocido** de Wikidata: anónimas declaradas. El fallo real era de 6 por cada
2.000. Antes de dar por bueno un número que promete mucho, mirar qué hay dentro
del dato.

**`npm run … -- --limit N` no llega al script.** npm reconoce `--limit` como
configuración suya y se la queda; al script solo le llega el número. Pasó con
`fix-artists`, que ahora usa `--max`.

**`create or replace function` NO puede cambiar el tipo de retorno.** Postgres
aborta con `cannot change return type of existing function` y, como el editor
SQL de Supabase envuelve el script en una transacción, **tumba la migración
entera en silencio**: parece que fue bien y no se ha aplicado nada. Si una
migración cambia la firma de una función, `drop function if exists` antes. Con
`npm run migrate -- --dry-run` esto se caza en dos segundos.

**No tocar el catálogo con una ingesta viva.** Fusioné movimientos mientras
corría una ingesta; el proceso tenía en caché el id de un movimiento que borré
y un museo entero se cayó con un fallo de clave foránea.

**Medir por el camino del usuario, no por el cómodo.** Dos veces el mismo
error. La sonda de imágenes pedía la URL original en vez de la miniatura que
pide el navegador; y la de rendimiento medía con `service_role`, que no tiene
el `statement_timeout = 3s` del rol `anon` — daba todo por bueno mientras la
web devolvía 500.

**Un 429 no es un error de datos.** Le metí 150 peticiones seguidas a Commons,
me devolvió 429 en 126 y estuve a punto de dar por rotas casi todas las
imágenes del catálogo.

**No compilar mientras otro servidor sirve ese mismo `.next`.** Llegué a
concluir en voz alta que las URLs traducidas rompían la portada. Era un
`next start` de otra terminal leyendo el `.next` que yo borraba.

**Un `--dry-run` no debe escribir nada, ni siquiera un checkpoint.** El
simulacro marcaba el museo como hecho y la siguiente ejecución real se lo
saltaba, dejándolo fuera del catálogo sin avisar.

**Los índices parciales solo se usan si la consulta nombra su condición.** Al
hacerlos parciales sobre `status = 'published'`, las funciones que no
mencionaban `status` dejaron de usarlos: "cerca de mí" pasó de 0,6 a 8
segundos. Y con RLS activo hay un segundo efecto — la política se aplica antes
que las condiciones no *leakproof* como `st_dwithin`, lo que descarta el índice
geográfico. De ahí el `SECURITY DEFINER` de `0014`, cuyo precio es que **la
garantía de visibilidad pasa a ser el `where status = 'published'` escrito
dentro de cada función**. Quien lo borre por parecerle redundante publicará las
59.000 obras que esperan.

**Un caso no es una fuente.** Di por bueno que Europeana tenía el arte del
siglo XX porque existía una miniatura de Picasso. Tenía 10 imágenes de Warhol
en total.

**No se puede medir una API mientras otro proceso la está usando.** Intenté
medir el tamaño óptimo de lote contra WDQS con la ingesta corriendo: 50 obras
en 20 s, 200 en 21 s, y una repetición en 139 ms por caché. Números sin sentido.
Las mediciones de red se hacen con la máquina en reposo.

**El agente no puede terminar procesos.** Está bloqueado, así que una ingesta
lanzada en segundo plano no se puede cortar desde aquí ni con `TaskStop` —el
proceso hijo sobrevive—. Si hay que pararla, es cosa del Administrador de
tareas. Conviene tenerlo en cuenta ANTES de lanzar algo de nueve horas.

**La app enseña la traducción, no el campo canónico.** Todo lo que se ve
—títulos, nombres de artista, de museo, de movimiento, ciudades— sale de
`coalesce(traducción del idioma, inglés, canónico)`. Un formulario que solo
edite lo canónico parece funcionar y no cambia nada de lo que se lee. Pasó con
«El Bosco» y es la razón de que exista el bloque de idiomas.

**Un recuento estimado del planificador puede mentir en un tercio.** El menú del
catálogo pedía `count: 'estimated'` para las obras y decía 172.776 cuando había
269.159: las estadísticas de Postgres envejecen entre ingesta e ingesta. Exacto
tampoco se puede —se come los 3 s del rol—, así que ese número simplemente no se
enseña. Un número que miente es peor que ninguno.

**Tras rotar la contraseña de la base, el primer intento puede fallar.** Pasó el
1 de septiembre: falló uno y funcionó el siguiente. Es la conexión vieja, no la
contraseña. No hay que deshacer nada — reintentar.

**`ANALYZE` después de una ingesta grande.** Tras meter 100.000 filas, Postgres
seguía planificando como si la tabla tuviera 6.000. Ahora lo hace la propia
ingesta al terminar, porque es ella quien ensucia las estadísticas.


---

## Y lo demás, en el historial

Todo lo hecho —el giro de curar a amasar, la Galería Nacional entera, la
aplicación de ingesta, las ciudades, las imágenes, la pantalla de entrar, el
buscador que se caía— está contado con su porqué en
[HISTORIAL.md](HISTORIAL.md).
