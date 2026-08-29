# Notas de trabajo

Estado al 29 de agosto de 2026 (mediodía) y lo siguiente a hacer.

---

## AL EMPEZAR: lo que queda por hacer

Nada está corriendo. El catálogo está sano: 147.869 obras, 47 de 48 museos
completos, 214 MB de los 500 del plan gratuito.

**Lo que Manuel quiere que se haga, por orden:**

1. **La aplicación de ingesta.** La primera mitad —**ver la ingesta**— está
   hecha el 29 de agosto por la mañana: el estado vive en la base y se mira en
   `/es/admin/ingesta`. Queda la segunda: **formularios** para crear y corregir
   obras, artistas, museos y movimientos a mano, y **lanzar** la ingesta desde
   la pantalla (parar ya se puede). Sección **LA APLICACIÓN DE INGESTA**, con
   las tres cosas que hay que decidir antes de escribir el primer formulario.

2. **La Galería Nacional de Arte** (`Q214867`), el único museo que falta. Ya
   está medido y el arreglo identificado —partir la consulta por titulares de
   ≤5—, pero **hay que volver a medir con WDQS sano** antes de escribirlo.
   Sección propia.

3. **Imágenes de las obras que esperan**: `fill-images` (Nationalmuseum, ~23.000
   obras), luego `promote` y `audit -- --images`.

4. **Ingesta incremental**: no rehidratar desde Wikidata lo que ya tenemos
   igual. Es lo que más rinde de cara a seguir metiendo museos.

5. **Rotar la contraseña de la base**, que pasó por una conversación.

6. **El repaso visual de la web**, que sigue pendiente desde el 28: la ficha de
   obra no ofrece a dónde seguir, la tarjeta mide 580 px en el móvil, los
   títulos arrastran ruido de Wikidata («El columpio (Goya)») y faltan las
   transiciones entre vistas. Sección **Lo hecho en la web**.

Y una advertencia que ahorra una noche: **no usar `reanudar-ingesta.cmd`**, que
no es de fiar. El comando que sí funciona está en la sección siguiente.

---

## Dónde nos quedamos

El catálogo pasó de **6.161 obras a 147.869**. Lo que cambió no fue solo el
tamaño: cambió la idea. Antes se descartaba lo que no se podía enseñar; ahora se
guarda todo y una columna dice qué es visible.

Cifras del 29 de agosto de 2026, tras entrar el Met (21.291 obras él solo):

| | |
|---|---|
| Obras en total | 147.869 |
| Publicadas (visibles en la app) | 76.667 |
| Esperando datos | 71.200 |
| Rechazadas (no son obras) | 2 |
| Artistas | 17.616 |
| Museos en el mapa | 48 (47 completos; falta la Galería Nacional de Arte) |
| Espacio | **214 MB** de los 500 del plan gratuito (42,8%) |
| Idiomas | es, en, fr (eran 7; se recortó por espacio) |

**Ojo al espacio**: eran ~160 MB con 124.600 obras y ahora son 214 con 147.869,
o sea ~1,45 KB por obra. Quedan unas 195.000 obras de margen antes de tocar los
500 MB. Sigue habiendo sitio para más museos, pero ya no es ilimitado y conviene
mirarlo (`npm run check-db`) antes de meter uno grande.

Migraciones `0001`–`0025`, **todas aplicadas** (comprobado el 29 de agosto con
`npm run migrate -- --status`). Ya no se aplican a mano: `npm run migrate`.

Hay además un **panel de revisión** en `/[lang]/admin`, con acceso por enlace
al correo. `manuel@softie.dev` ya es administrador.

### Estado del barrido (29 de agosto de 2026, 04:00)

**47 de los 48 museos están completos.** El barrido de esa madrugada duró
2 h 37 min y metió el Met entero, que llevaba dos días atascado: 21.291 obras él
solo. Solo falta la **Galería Nacional de Arte**, y tiene sección propia más
abajo.

Al retomar, lo primero es mirar si hay algo corriendo y cómo acabó:

```bash
tail -40 ingesta.log          # el barrido del 29
grep -E "✗|lote perdido|INCOMPLETO|Obras perdidas" ingesta.log
```

`ingesta-barrido.log` e `ingesta-fallido-utf16.log` son rastros de los intentos
fallidos del 28 y del 29; no hace falta leerlos.

**NO usar `reanudar-ingesta.cmd`: no es de fiar.** El 29 de agosto se descubrió
que **nunca ha llegado a lanzar un barrido**. Moría siempre en las migraciones
sin escribir una línea, y el log del 28 lo demuestra: se corta en el mismo sitio
que el del 29. Se le arreglaron dos trampas reales de PowerShell 5.1 (están
documentadas dentro del script: `2>&1` con `$ErrorActionPreference = 'Stop'`, y
el UTF-16 de `Tee-Object`) y **aun así se murió una segunda vez en silencio**,
sin disparar ni su propio `trap`. Queda sin diagnosticar.

La forma que sí funciona es lanzar el barrido directamente, sin PowerShell de
por medio:

```
cmd /c "chcp 65001 >nul & set PATH=%APPDATA%\nvm\v22.12.0;%PATH% & cd /d C:\projects\artlas\packages\ingest & npm run start -- --all --everything >> C:\projects\artlas\ingesta.log 2>&1"
```

Antes, a mano: `npm run migrate -- --status` y comprobar que no hay ingesta viva
(`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"` filtrando por
`cli.ts`). Tocar el catálogo con una ingesta viva ya tumbó un museo.

Ya hecho, no hay que repetirlo:

- **Las 25 migraciones, aplicadas.**
- **Movimientos fusionados** (215 → 214) y **198 artistas con nombre-URL,
  borrados**.
- **Autores recuperados**: 1.545 obras, Guernica entre ellas. Sección propia.

Lo siguiente, que ya se puede hacer porque no hay ingesta corriendo:

```bash
cd packages/ingest
npm run fill-images                # en seco: cuántas encontraría
npm run fill-images -- --apply     # Nationalmuseum: ~23.000 obras esperando
npm run promote -- --apply         # publica las que ya cumplen
npm run audit -- --images          # la última pasada es de cuando había 6.460
```

### Comprobar al retomar

```bash
cd packages/ingest
npm run migrate -- --status   # ¿hay migraciones sin aplicar?
npm run check-db              # esquema, credenciales y espacio ocupado
npm run check-gate            # el clasificador de entrada, sin red ni base
npm run check-perf            # ¿responden las consultas de la app? (clave anon)
npm run peek                  # qué hay en el catálogo
```

Y para ver el panel sin esperar un correo (el acceso es por enlace mágico):

```bash
cd apps/web && npx next dev -p 3111
node apps/web/scripts/ver-panel.mjs /es/admin/ingesta salida.png
```

`ver-panel.mjs` emite el mismo token que emitiría el correo, lo canjea y escribe
la cookie con el propio código de `@supabase/ssr`. La página sigue leyendo con
la sesión y sujeta a las políticas: es el camino del usuario, no un atajo. Desde
Git Bash hace falta `MSYS_NO_PATHCONV=1` delante o convierte `/es/...` en una
ruta de Windows.

Requiere **Node 22**. Si `node -v` dice 16, es el del PATH de Windows; el bueno
está en `%APPDATA%/nvm/v22.12.0`.

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

## Herramientas

| Comando | Para qué |
|---|---|
| `npm run migrate` | Aplica migraciones. `--dry-run` las ejecuta y hace ROLLBACK. |
| `npm run start -- --all --everything` | Barrido completo (~10 h, reanudable). |
| `npm run audit -- --images` | Audita el catálogo. Imágenes en pasadas de 800. |
| `npm run promote` | Reclasifica lo que ya está dentro. |
| `npm run fill-images` | Busca imágenes en la API del museo. |
| `npm run merge-movements` | Fusiona movimientos duplicados. |
| `npm run check-*` | Comprobaciones. |
| `node apps/web/scripts/ver-panel.mjs <ruta> <png>` | Abre el panel con sesión de administrador. |

**Todas escriben solo con `--apply`** (o aplican solo sin `--dry-run`, en el
caso de `migrate`). Es deliberado: casi todas mueven o borran filas.

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

## PENDIENTE: la Galería Nacional de Arte (Q214867) no entra

Es el único museo de los 48 que sigue fuera. Cayó dos veces el 29 de agosto de
2026 enumerando, con 504 y 502. **No tiene checkpoint**, así que cualquier
barrido la reintenta sola; no hay que hacer nada especial para que se reintente.

Medido antes de tocar nada, y desmintiendo la hipótesis obvia: **no es el
`OFFSET` profundo**. Su consulta de enumeración es cara de por sí y no cabe en
los 60 s del endpoint.

```
  A) como está hoy          OFFSET 0     65,3 s  ✗ 504
                            OFFSET 500   60,4 s  ✗ 429
                            OFFSET 1000  65,5 s  ✗ 504
  B) por cursor, sin OFFSET pág. 1       54,8 s  ✓ 500 filas
                            pág. 2       60,2 s  ✗ 500
  C) partida por titular    1 titular    25,9 s  ✓
                            5 titulares  31,8 s  ✓
                            10 titulares 65,2 s  ✗ 504
```

**El arreglo candidato es partir por titulares en grupos de ≤5** —tiene 37 en su
árbol— y paginar dentro de cada grupo. Es la lección nº2 de la cabecera de
`wikidata.ts` aplicada un nivel más abajo: cuando algo va lento, partir la
consulta.

**No implementado a propósito.** Durante la medición WDQS devolvía 429 y 502 a
los 216 ms, que no es una consulta cara sino el servidor echándonos tras una
noche entera de barridos. Diseñar sobre esos números sería construir sobre
ruido. **Volver a medir con el endpoint sano antes de escribir el cambio.**

---

## HECHO: autores recuperados (1.545), y por qué no eran 9.336

`npm run fix-artists -- --apply`, ejecutado el 29 de agosto de 2026.
**1.545 obras recuperaron su autor**, 122 artistas distintos, cero lotes
fallidos. **Guernica ya es de Pablo Picasso** (era la prueba de fuego).

**El titular anterior de estas notas —«9.336 autores perdidos»— era falso.** Sí
había miles de obras publicadas sin `artist_id`, pero la mayoría son anónimas de
verdad: no declaran `P170`, o lo declaran con el **valor desconocido** de
Wikidata —«tiene autor, pero no se sabe quién»—, que en SPARQL llega como un
nodo `genid` y no como un QID. Confundir ese caso con un fallo propio hacía
creer que quedaban miles de autores por rescatar. Fallo nuestro de verdad: **10
de 13.764**, un 0,07%. Ruido, no un filón.

La pasada es reanudable e idempotente (solo mira `artist_id is null`) y separa
los tres casos en su resumen, para que si ese 0,07% sube algún día, se note.

**Quedan 12.278 publicadas sin autor y está bien que así sea**: son las anónimas.
No volver a leer ese número como una avería.

Cuidado con el nombre de las banderas: `npm run … -- --limit 50` **no llega al
script**, porque npm reconoce `--limit` como configuración suya y se la queda.
Por eso la bandera se llama `--max`.

### Los tres fallos de visibilidad que se arreglaron el 29 de agosto

Los tres son de la misma familia, y son la razón de ser de la aplicación de
ingesta que Manuel pidió: **el proceso fallaba y nadie se enteraba.**

1. **Un lote perdido mataba el museo entero.** Si Wikidata agotaba los
   reintentos en un lote de 50 obras, la excepción salía del generador y se
   llevaba por delante horas de trabajo ya escrito. El Met murió así dos días
   seguidos. Ahora se pierde el lote, se dice en voz alta y el museo sigue.
   Igual con las páginas de enumeración, con un tope de tres fallos SEGUIDOS: a
   la tercera, el problema no es pasajero y el museo aborta de verdad.

2. **Un museo incompleto podía quedar marcado como hecho**, que es peor que
   fallar: el checkpoint lo daba por bueno y no se reintentaba jamás. Ahora
   guarda cuántas obras se perdieron (`lost`), y un museo con pérdidas se rehace
   solo en el barrido siguiente.

3. **El resumen final mentía.** Decía `Obras perdidas 0` con cuatro páginas
   perdidas en el log, porque al abortar un museo sus cifras se quedaban en el
   `catch` de `ingestAll` y no se sumaban a los totales. Ahora el fallo se
   atiende dentro de `ingestMuseum`: cuenta lo perdido, devuelve lo conseguido y
   **no escribe checkpoint**. Un resumen que miente es peor que no tenerlo,
   porque se le cree.

---

### Por qué se perdieron: el idioma `mul` de Wikidata

Wikidata estrenó el código de idioma **`mul`** ("multilingüe") para los nombres
que se escriben igual en todas las lenguas, y al adoptarlo BORRÓ de muchas
entidades sus etiquetas por idioma, por redundantes. Medido:

```
  Pablo Picasso (Q5593)      102 etiquetas · mul="Pablo Picasso" · en=— · es=—
  Vincent van Gogh (Q5582)   240 etiquetas · mul y en y es, las tres
  Claude Monet (Q296)        149 etiquetas · mul y en y es, las tres
```

Nuestras consultas pedían `es,en,fr`, así que Picasso volvía **sin nombre**: el
servicio de etiquetas devolvía el propio QID ("Q5593") y la consulta plana de
textos, cero filas. Y el código descartaba al artista cuando el nombre era igual
al QID. Por eso el fallo parecía aleatorio: dependía de si a esa entidad le
habían quitado las etiquetas sueltas o no.

Arreglado en `wikidata.ts` (28 de agosto): `mul` entra en el filtro de idiomas y
en el servicio de etiquetas, se guarda como RESPALDO de los idiomas del catálogo
—solo donde falte el propio, para no convertir "La Gioconda" en "Mona Lisa"— y
el nombre del autor se busca en las dos fuentes antes de darlo por anónimo.

**Ojo al re-ingerir**: esto afecta a todo lo que lleve etiqueta, no solo a los
autores. Títulos, materiales, géneros y movimientos que hoy estén vacíos pueden
llenarse solos en la próxima pasada.

---

## Lo hecho en la web el 28 de agosto (tarde)

**Paginación en museo, artista y buscador.** El catálogo estaba invisible
detrás de un tope de 60: el Prado enseñaba 60 obras de sus 3.990 y no había
manera de ver la 61, y la ficha de artista hacía lo contrario, volcar 374 de
golpe —215.863 píxeles de alto en un móvil, ahora 21.921—. Migraciones 0023
(`p_offset` y `artworks_by_institution`), 0024 (el índice) y 0025 (paginar en
dos pasos, tras un 500 en producción en la primera visita a cada página
profunda). 36 obras por página; enlaces de verdad, no botones, así que la
página vive en la URL y se indexa.

Lo que queda de aquel repaso visual, por orden de lo que más chirría:

1. **La ficha de obra muere en un vacío** y no ofrece a dónde seguir: ni más
   obras del mismo museo, ni del mismo artista. En una ventana de 900 px de
   alto, Guernica ocupa 588 y el pie flota a media página.
2. **La tarjeta es enorme en móvil**: 580 px cada una, una sola columna. Las
   páginas siguen midiendo 21.000 px por eso, no por el número de obras.
3. ~~La cabecera repite el buscador grande~~ — arreglado lo urgente el 28 de
   agosto: en el móvil el campo se quedaba en 40 px, una cajita donde no cabía
   una letra. Se quita el botón «Buscar» (el teclado del móvil ya trae el suyo)
   y los campos pasan a 16 px para que Safari no haga zoom al tocarlos. Queda
   pendiente lo estético: que no aparezca a pantalla completa dentro de una
   obra.
4. **Los títulos arrastran ruido de Wikidata**: «El columpio (Goya)», con el
   pintor repetido justo debajo.
5. **Las transiciones entre vistas**, que era lo que Manuel pedía junto al
   estilo: View Transitions, esqueletos de carga y precarga al pasar el ratón.

---

## Lo siguiente, en orden

**0. La aplicación de ingesta.** Ver la ingesta ya está hecho (29 de agosto,
mañana). Queda editar el catálogo a mano y lanzar desde la pantalla. Tiene
sección propia más abajo. Sigue delante de todo lo demás porque cambia *cómo*
se hace el resto, no solo *qué*.

**0 bis. La Galería Nacional de Arte**, el único museo que falta. Ya está
medido; solo hay que volver a medir con WDQS sano y partir la consulta.

**1. Imágenes desde las APIs de los museos.** De las ~71.000 que esperan,
**todas esperan por lo mismo** (`image_missing`) y unas 22.500 están en dominio
público. No es arte del siglo XX inaccesible: son obras libres sin foto en
Commons, que sus museos sí publican.

El conector del Nationalmuseum (23.214 esperando, un tercio del total) está
escrito y sin ejecutar: `npm run fill-images`. Cruza por número de inventario,
no por título — sus títulos están en sueco y los nuestros en inglés.

**Es el único conector de imágenes que existe.** Los demás museos están en la
lista de «algún día» del final: cada uno es un conector nuevo, y Manuel decidió
el 28 de agosto que no bloqueen el trabajo en la aplicación.

**2. Las ~60.000 imágenes sin verificar**, en pasadas incrementales de 800
(`npm run audit -- --images`).

**3. Ingesta incremental.** Reingerir un museo vuelve a hidratar TODAS sus obras
desde Wikidata aunque ya las tengamos idénticas. Saltarse los QID ya conocidos
haría que añadir museos nuevos costara solo lo nuevo. Es lo que más rendiría de
cara a seguir metiendo museos.

**4. Rotar la contraseña de la base**, que pasó por una conversación.

**Cabo suelto pequeño**, de las pruebas del 29 por la mañana: la Galería
Nacional de Canadá (`Q1068063`) y la Galería de la Academia de Florencia
(`Q10855544`) se reingirieron con las opciones por defecto para probar el panel,
así que su checkpoint quedó al umbral 2 en vez de al 0. No se ha perdido ninguna
obra —la ingesta solo actualiza—, pero el próximo `--all --everything` los
rehará. Es el comportamiento correcto y no hay que tocar nada.

---

## Ya hecho en la sesión del 28 (por si se busca)

- Migraciones `0011`–`0022`: identidades mezcladas, camino rápido del buscador,
  `artworks_near` usando su índice, `SECURITY DEFINER`, buscador por UNION,
  derechos en las RPC, `profiles` con rol, y revisión de hallazgos.
- **Panel de revisión** en `/[lang]/admin`: acceso por enlace al correo,
  bandeja de hallazgos, confirmar y descartar.
- **Los derechos en la interfaz**: un solo componente (`ArtworkImage`) que
  obedece a `image_mode`, con las tres ramas probadas.
- **Optimización de la ingesta**: el enriquecimiento pasa a lotes concurrentes y
  solo para obras a las que les falta algo. Era 24 veces más lento que la
  ingesta sin enriquecer y era el cuello de botella de todo.
- `npm run migrate` con `--dry-run`, `--only` y `--seed`.

---

## Europeana: comprobado que NO sirve para esto

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

## LA APLICACIÓN DE INGESTA (pedida el 29 de agosto de 2026)

Manuel paró el trabajo para decir que **la ingesta no puede seguir siendo una
conversación con el asistente**: quiere un programa que la haga y una pantalla
que enseñe qué está pasando. Sus palabras: *«no quiero que sea un diálogo
contigo, quiero que sea un programa que lo hace»*, y *«no quiero que se quede
intentándolo una y otra vez mientras falla y yo no sepa nada»*.

**El caso que lo provocó**, para no perderlo de vista: el barrido del 28 de
agosto dejó 6.546 líneas de log de las que ~6.400 eran `reintento N/M`.
Filadelfia agotó sus cuatro reintentos y murió a las 19:17; el Met quedó cortado
a mitad. Se supo catorce horas después, y porque alguien leyó el log a mano.

Dos mitades. **La primera está hecha**; la segunda no.

### 1. Ver la ingesta — HECHO el 29 de agosto (mañana)

Migración **0026**, `packages/ingest/src/run-log.ts` y
`apps/web/app/[lang]/admin/ingesta/page.tsx`.

- **El estado vive en la base**: `ingest_runs` (una ejecución) e `ingest_steps`
  (un museo dentro de ella, con sus cifras y su error). El log de texto se
  queda para el detalle. Los totales de la ejecución van en un `jsonb` porque
  son para leer; las cifras por las que se consulta están en `ingest_steps`.
- **Pantalla en `/[lang]/admin/ingesta`**, enlazada desde el panel. Se refresca
  sola cada 5 s **solo mientras hay algo corriendo** (`components/AutoRefresh`
  llama a `router.refresh()`; no hay ruta de API nueva, así que sigue leyendo
  con la sesión y sujeta a RLS).
- **Se puede parar desde la pantalla.** `request_ingest_cancel()` levanta una
  bandera que la ingesta mira **entre museos**, no dentro: cortar un museo a la
  mitad lo deja sin checkpoint y habría que rehacerlo entero.
- **Los reintentos son un número**, no 6.400 líneas: `retryCount()` en
  `util/http.ts` y una columna por museo.

**Lo que más costó acertar, y lo que hay que respetar si se toca:**

*Un `running` no quiere decir vivo.* Un proceso que muere de golpe deja su fila
diciendo `running` para siempre — exactamente la ceguera del 28. Por eso hay
`heartbeat_at` y `reap_dead_runs()`, que cierra con el motivo lo que lleve diez
minutos sin latir. La llaman la ingesta al arrancar y el panel al pintarse.

*El latido dice «existo», no «avanzo».* Es de reloj, cada 30 s, y no de trabajo
hecho. Se probó lo segundo y estaba mal: una consulta atascada pasa hasta 8 min
entre reintentos, y el Met, con 2 h 37 min de museo, se habría dado por muerto a
los diez minutos. **Un vigilante que mata al vigilado es peor que no tenerlo.**
Si avanza o no se ve aparte, en las cifras del museo en curso, que suben lote a
lote. Son dos preguntas y tienen dos respuestas.

*Contar no puede tumbar la ingesta.* Si Supabase no acepta un `update` de
progreso, se avisa **una vez** y se sigue; el resumen final recuerda que el
panel se quedó ciego. Callar ahí reproduciría el problema que esto vino a
arreglar.

**Comprobado de verdad**, no solo compilado: un `anon` no ve una fila de estas
tablas y un administrador las ve todas (sonda con el rol `authenticated` y su
JWT, que es como consulta la página); ni el administrador puede escribirlas a
mano —parar solo se pide por la función—; una ingesta real escribe su ejecución
y sus museos; y el caso Filadelfia, simulado, deja `failed` con «el proceso
murió sin decir nada: última señal de vida a las 19:33».

**Lo que NO está hecho de esta mitad:**

- **Lanzar desde la pantalla.** Parar sí; lanzar necesita un proceso que esté
  escuchando, y eso es otra cosa que decidir (¿un servicio en la máquina? ¿una
  función programada?).
- **Reanudar sola dentro de un museo.** El checkpoint por museo ya existía; el
  estado *dentro* de un museo se ve ahora, pero al reanudar se rehace entero.
- El botón de parar está probado a nivel de función (`anon` rechazado con su
  motivo, administrador aceptado); **no se ha ejercitado una parada en vivo**
  con un barrido de varios museos.
- Las filas de `ingest_runs`/`ingest_steps` no se borran nunca. Son diminutas
  (~48 filas por barrido), pero si algún día molestan, la retención es trivial.

### 2. Editar el catálogo a mano — PENDIENTE

Formularios en el panel para **crear y corregir obras, artistas, museos y
movimientos**. Esto ya estaba pedido en pequeño («alta manual de obras») y ahora
va entero.

Lo que hay que resolver antes de escribir el primer formulario:

- **Política de escritura sobre las tablas del catálogo.** Hoy solo escribe la
  ingesta, con `service_role`. Hacen falta RLS de escritura para el rol de
  administrador.
- **`status_locked`** (o equivalente) para que la ingesta no pise una decisión
  tomada a mano. Vale para el estado y para cualquier campo corregido: si
  alguien arregla un título, la siguiente pasada de Wikidata no puede
  devolverlo a como estaba.
- **Qué manda cuando discrepan** la fuente y la persona. Sin esa regla escrita,
  los formularios crean trabajo en vez de ahorrarlo.

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

- **Valoraciones de usuarios.** Tablas y RLS desde `0001`; falta Supabase Auth
  y la interfaz.
- **La técnica sale como soporte.** Wikidata usa `P186` (material), que da
  "lienzo" en vez de "óleo sobre lienzo".
- **La licencia concreta de cada fichero de Commons.** Hoy se guarda
  "Wikimedia Commons" a secas. Traer la licencia real son ~3.650 peticiones a
  su API; solo cambia la línea de atribución.
- **Los 4 idiomas retirados** (it, de, pt, nl). Los textos de interfaz y los
  segmentos de URL siguen escritos: reactivarlos es añadirlos a `LANGS`,
  `LANG_NAMES`, `SEGMENTS` y `LANGUAGES`, y reingerir. Lo que no cabía en 500 MB
  eran sus traducciones de catálogo.
- **`apps/web/tsconfig.tsbuildinfo` está versionado** y cambia en cada build.

---

## Tropiezos de método, para no repetirlos

**Un lanzador que falla en silencio es peor que no tener lanzador.**
`reanudar-ingesta.ps1` llevaba dos días sin lanzar un solo barrido y nadie lo
sabía, porque moría sin escribir nada. Se dio por hecho que funcionaba al ver el
proceso arrancar. La comprobación que faltaba costaba diez segundos: mirar si el
log avanza más allá del arranque. Ver también las dos trampas de PowerShell 5.1
que lo causaban, documentadas dentro del propio script.

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

**`ANALYZE` después de una ingesta grande.** Tras meter 100.000 filas, Postgres
seguía planificando como si la tabla tuviera 6.000. Ahora lo hace la propia
ingesta al terminar, porque es ella quien ensucia las estadísticas.
