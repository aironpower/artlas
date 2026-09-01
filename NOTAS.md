# Notas de trabajo

Estado al 1 de septiembre de 2026 y lo siguiente a hacer.

---

## AL EMPEZAR: lo que queda por hacer

Nada está corriendo. El catálogo está sano: **269.159 obras** (135.261
publicadas), **48 de 48 museos completos**, **374 MB** de los 500 del plan
gratuito.

**Lo que Manuel quiere que se haga, por orden:**

1. **La aplicación de ingesta.** Hecho el 29 de agosto: ver la ingesta en vivo,
   y **pedir y parar los trabajos desde la web**. Arranca el trabajador
   (`trabajador.cmd`, doble clic) y todo se maneja desde `/es/admin/ingesta`.
   Los **formularios** también están: obras y artistas (0028-0031) y, desde el
   29 por la noche, museos, movimientos y los textos de cada idioma (0033), con
   listas para navegarlos en `/es/admin/catalogo`. Sección **HECHO: corregir el
   catálogo entero a mano**. Y el 31, las **quince ciudades** que Wikidata dejó
   como barrio o distrito: sección **HECHO: las ciudades, corregidas**.

2. ~~La Galería Nacional de Arte~~. **Ya no falta**: entró entera el 29 de
   agosto, 48 de 48 museos. Este punto llevaba días viejo en esta lista; la
   sección «HECHO: la Galería Nacional de Arte entró entera» es la buena.

3. ~~Imágenes de las obras que esperan~~. **Hecho el 1 de septiembre**: 9.894
   imágenes del Nationalmuseum rellenadas y publicadas, y la verificación de
   imágenes reescrita para que dure minutos y no días. Sección **HECHO: las
   imágenes, y lo que costó verlas**.

4. **Ingesta incremental**: no rehidratar desde Wikidata lo que ya tenemos
   igual. Es lo que más rinde de cara a seguir metiendo museos.

5. **Rotar la contraseña de la base**, que pasó por una conversación.

6. **El repaso visual de la web**, casi terminado. Hechos el color, el mapa de
   papel, la ficha con salida, las dos columnas del móvil y los esqueletos de
   carga. Quedan dos cosas: **limpiar el ruido de los títulos de Wikidata**
   («El columpio (Goya)») y las **View Transitions** con precarga al pasar el
   ratón. Secciones **Lo hecho en la web el 28** y **el 29 (tarde)**.

Y una advertencia que ahorra una noche: **no usar `reanudar-ingesta.cmd`**, que
no es de fiar. El comando que sí funciona está en la sección siguiente.

---

## Dónde nos quedamos

El catálogo pasó de **6.161 obras a 269.159**. Lo que cambió no fue solo el
tamaño: cambió la idea. Antes se descartaba lo que no se podía enseñar; ahora se
guarda todo y una columna dice qué es visible.

Cifras del **1 de septiembre de 2026**, tras entrar la Galería Nacional de Arte
y rellenar las imágenes del Nationalmuseum:

| | |
|---|---|
| Obras en total | 269.159 |
| Publicadas (visibles en la app) | **135.261** |
| Esperando datos | 133.896 |
| Rechazadas (no son obras) | 2 |
| Artistas | 21.619 |
| Museos en el mapa | **48 de 48, ninguno a medias** |
| Ciudades | 34 (eran 38; quince eran barrios o distritos) |
| Espacio | **374 MB** de los 500 del plan gratuito (74,8%) |
| Idiomas | es, en, fr (eran 7; se recortó por espacio) |

**Y las traducciones de los otros cuatro, borradas el 1 de septiembre.** Quedaban
16.819 filas en alemán, italiano, neerlandés y portugués, restos de cuando la
ingesta pedía siete idiomas. No se borraron por espacio —eran 3,6 MB, un 1%—
sino porque **estaban congeladas y ya eran mentira**: la ingesta solo pide
es/en/fr desde el recorte, así que no se actualizan nunca, y en esos cuatro
idiomas el Louvre seguía en «Saint-Germain-l'Auxerrois» y el Met en «Manhattan»
porque las ciudades se corrigieron solo en lo que se enseña. La cobertura además
era simbólica: el alemán llegaba a 3.736 obras de 269.159, un 1,4%.

**La tabla `languages` se queda con sus siete filas** y no es descuido: son la
definición —qué diccionario de Postgres usa cada idioma— y la receta para
reactivar uno. Se borraron los datos, no el mapa. Reactivar un idioma sigue
siendo añadirlo a `LANGUAGES` en `types.ts` y **reingerir**; tener medias
traducciones viejas no era un atajo para eso.

**Ojo al espacio, que ha dado un susto.** Llegó a 495 MB —el 99%— y no por las
obras: `audit_findings` se había comido 121 MB guardando una fila por obra para
decir cosas que la obra ya decía. Corregido, la base está en 374 MB. Las obras
salen a ~0,89 KB, así que quedan unas 140.000 de margen. Conviene mirarlo
(`npm run check-db`) antes de meter un museo grande, y **desconfiar de lo que
crece sin ser el catálogo**.

Migraciones `0001`–`0033`, **todas aplicadas** (comprobado el 31 de agosto con
`npm run migrate -- --status`). Ya no se aplican a mano: `npm run migrate`.

Hay además un **panel de revisión** en `/[lang]/admin`, con acceso por enlace
al correo. `manuel@softie.dev` ya es administrador.

### Estado del barrido (29 de agosto de 2026, 04:00)

**47 de los 48 museos quedaron completos esa madrugada.** El barrido duró
2 h 37 min y metió el Met entero, que llevaba dos días atascado: 21.291 obras él
solo. El que faltaba, la Galería Nacional de Arte, **entró esa misma tarde**:
son 48 de 48 y tiene sección propia más abajo.

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

- **Las 33 migraciones, aplicadas.**
- **Movimientos fusionados** (215 → 214) y **198 artistas con nombre-URL,
  borrados**.
- **Autores recuperados**: 1.545 obras, Guernica entre ellas. Sección propia.

La cadena de las imágenes, ya ejecutada el 1 de septiembre y aquí por si hace
falta repetirla con otro museo:

```bash
cd packages/ingest
npm run fill-images                # en seco: cuántas encontraría
npm run fill-images -- --apply     # rellena, tras comprobar que 20 cargan
npm run promote -- --apply         # publica las que ya cumplen
npm run audit -- --images          # verifica 10.000 por pasada, ~5 min
```

`fill-images` tarda ~30 min: cuatro pidiéndole los inventarios a Wikidata y el
resto descargándose las 2.084 páginas del catálogo del museo, que no admite
búsqueda.

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
| `npm run audit -- --images` | Audita el catálogo. Imágenes de 10.000 en 10.000, preguntando a Commons por lotes de 50. |
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

## HECHO: la Galería Nacional de Arte entró entera (127.244 obras)

**Terminada el 29 de agosto de 2026 a las 18:40**, tras 5 h 22 min, pedida
desde la web y sin nadie delante. **0 obras perdidas, 0 lotes fallidos**, 160
reintentos en total. Son **48 de 48 museos**: el mapa ya no tiene huecos.

El catálogo queda en **269.159 obras** (125.367 publicadas, 143.790 esperando
datos), 21.619 artistas y **348,1 MB de los 500** del plan gratuito.

**Y el espacio salió mucho mejor de lo temido.** Medido con muestras de 50
minutos: **0,89 KB por obra**, no los 1,45 estimados, porque tres de cada
cuatro obras de la Galería entran como pendientes y esas no llevan
traducciones. La primera proyección —hecha sobre los primeros minutos— decía
641 MB y era falsa: las obras de esos minutos ya estaban en la base de los
intentos fallidos de la noche anterior, así que se medía el coste de
actualizar filas, no el de crearlas. **Nunca proyectar sobre el arranque de un
proceso.**

Quedan unos 150 MB de margen. Con este coste por obra, sitio para otras
~170.000.

---

## Cómo se arregló la Galería Nacional: la causa era otra

**Resuelto el 29 de agosto de 2026 por la tarde**, y la causa apuntada abajo
era falsa. Se deja el registro porque el error de diagnóstico es instructivo.

**No era el `OFFSET` profundo ni los 37 titulares: era el `ORDER BY ?work`.**
La misma consulta, sobre los mismos titulares:

```
  con ORDER BY ?work ........  60 s y 504
  sin ORDER BY ..............  1,0 s y 121.331 obras
```

Ordenar un `DISTINCT` obliga a materializar el museo entero antes de devolver
las primeras 500 filas, así que la primera página costaba lo mismo que todo el
museo. Y ese orden solo estaba para que el `OFFSET` fuera estable. Sin paginar,
sobra. Partir por titulares —el arreglo que estaba apuntado como candidato— no
servía: se midió y un solo titular seguía tardando 36,8 s.

**El museo tiene 121.331 obras**, cinco veces el Met y el mayor de la semilla
con diferencia. Manuel decidió meterlo entero y medir el espacio a mitad. Al
ritmo actual (~1,45 KB/obra) serían ~175 MB y la base pasaría de 215 a ~390 de
los 500; las que no traen imagen son más baratas, así que es el peor caso.

**Segundo tropiezo, ya con el arreglo puesto: WDQS corta las respuestas
grandes.** Los 121.331 QID ocupan 14,4 MB en JSON y llegaron truncados los
cinco intentos; la ingesta abortó. De ahí el plan B: si no cabe de un tirón, el
museo se parte en **diez rodajas por el último dígito del QID** —exhaustivas y
disjuntas, porque un QID siempre acaba en 0-9— de ~12.000 obras y 1,5 MB cada
una. Primero se intenta de un tirón porque a 47 de los 48 museos les basta.

**Por qué JSON y no TSV**, que ocupa un tercio y habría cabido: de tres
intentos en TSV, uno devolvió **72.400 de las 121.331 filas sin dar el menor
error**. Un TSV cortado parece una respuesta corta y correcta; un JSON cortado
no se parsea y el fallo se ve. Un formato que pierde datos en silencio no vale
por compacto que sea.

**Pendiente**: el plan B de las rodajas **no se ha ejercitado en vivo** —hace
falta que la consulta de un tirón falle, y falla unas veces sí y otras no—. Si
estuviera mal, el peor caso es el de siempre: museo abortado y rehecho al
siguiente barrido.

**Ojo con el espacio, medido en marcha.** Con las primeras 6.897 obras dentro,
la base pasó de 215,6 a 239 MB: **3,4 KB por obra**, no los 1,45 que se
estimaron. Si el ritmo se mantiene, la Galería entera son ~410 MB y el total
pasaría de 500. Hay que confirmarlo con más muestra antes de decidir nada, pero
si se confirma, el museo no cabe entero y habrá que elegir qué parte entra.

**Ojo con los contadores.** `refreshCounters` son tres UPDATE de tabla completa
sobre 148.000 filas y ya rozan el `statement_timeout`; con la Galería dentro
serían 270.000. Ya no tumban la ingesta (se avisa y se sigue), pero habrá que
mirarlo.

---

## PENDIENTE (superado, se conserva el diagnóstico viejo): por qué no entraba

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

De aquellos cinco puntos, **cuatro se hicieron el 29 por la tarde** y este
documento no se enteró hasta el 1 de septiembre. Estado real:

1. ~~La ficha de obra muere en un vacío~~ — **hecho**. Tiene su bloque «por
   dónde seguir», con más obras del mismo autor y del mismo museo.
2. ~~La tarjeta es enorme en móvil~~ — **hecho**. Por debajo de 560 px la
   rejilla pasa a **dos columnas fijas**, que parten el scroll por la mitad y
   además se parecen más a cómo se mira arte: varias piezas a la vez. Se fija
   `repeat(2, …)` en vez de bajar el `minmax`, que habría dado ocho columnas
   apretadas en un escritorio ancho. En una tarjeta de 165 px la tercera línea
   —el museo— se oculta: el título y el autor ya identifican la obra.
3. ~~La cabecera repite el buscador grande~~ — **hecho lo urgente**: en el móvil
   el campo se quedaba en 40 px, una cajita donde no cabía una letra. Se quita
   el botón «Buscar» (el teclado del móvil ya trae el suyo) y los campos pasan a
   16 px para que Safari no haga zoom al tocarlos. Queda lo estético: que no
   aparezca a pantalla completa dentro de una obra.
4. **PENDIENTE — los títulos arrastran ruido de Wikidata**: «El columpio
   (Goya)», con el pintor repetido justo debajo. Es lo único de esta lista que
   sigue entero sin hacer, y ahora se puede arreglar a mano desde
   `/es/admin/corregir` obra a obra, pero el paréntesis de desambiguación es
   sistemático y pide una regla.
5. **Las transiciones, a medias.** Hechos los **esqueletos de carga** —que la
   espera se vea como carga y no como un enlace roto— y la **animación de
   entrada** de 160 ms, con `prefers-reduced-motion` respetado en las dos.
   Faltan las **View Transitions** entre vistas y la **precarga al pasar el
   ratón**.

---

## Lo hecho en la web el 1 de septiembre: llegar a las páginas

Manuel lo vio mirando la app: **las fichas de museo y de artista existían y no
había cómo llegar a ellas.** Medido antes de tocar nada:

- **Museo**: solo pulsando su chincheta en el mapa —y era un `<button>` con un
  manejador, así que no se podía abrir en pestaña nueva, ni copiar su dirección,
  ni la seguía un buscador— o desde la ficha de una obra suya.
- **Artista**: solo desde la ficha de una obra suya. Había que dar con un cuadro
  de Goya para poder ver a Goya.
- Las tres cifras de la portada —obras, artistas, museos— eran **texto plano**.
- El buscador filtra por movimiento, país, ciudad, categoría y años, pero **no
  por museo ni por artista**: el parámetro `artista` se lee y nada en la
  interfaz lo pone.

**El primer intento no valía, y Manuel lo dijo claro: «esas páginas no sirven de
nada… no es práctico».** Eran dos listas planas de nombres. Una lista no es una
herramienta: no se puede ordenar, no dice de dónde es cada museo, y en el caso
de los artistas ni siquiera se podía buscar. Lo que hay ahora son **tablas
ordenables**, y la de artistas con **buscador propio**.

**Museos** (`/es/museos`): museo, ciudad, país y número de obras, las cuatro
columnas ordenables. Se ordena en memoria porque son 48 y ya están todos
pedidos: bajar a la base a reordenar 48 filas que tienes en la mano es pagar una
ida y vuelta por nada. Reutiliza `mapPins`, la misma consulta que pinta el mapa
de la portada, así que comparten la caché de una hora.

**Artistas** (`/es/artistas`): artista, nacionalidad, años y obras, ordenables
por las cuatro, con buscador y páginas de 60. Son **11.426 con obra** —no los
21.619 de la tabla, que incluye a quien no tiene ninguna—.

**El orden y la búsqueda viven en la URL**, no en JavaScript:
`?q=goya&orden=anios&dir=asc` se puede compartir, el botón de atrás deshace y
funciona sin hidratar. Es la misma decisión que ya tomaban el buscador y la
paginación.

### Por qué hizo falta una migración para los artistas

**El buscador de la web busca obras, no artistas.** Escribir «Goya» devolvía
cuadros, no al pintor; y la única función que encontraba artistas
—`admin_search_artists`, de 0031— está revocada a `anon` porque sirve para
corregir el catálogo. De ahí `list_artists` (0034, ampliada en 0035).

No se hace desde PostgREST por tres cosas: **el nombre que se enseña es
`coalesce(traducción, canónico)`**, así que buscar «El Bosco» tiene que
encontrar al que la tabla llama «Hieronymus Bosch» —comprobado en los dos
sentidos—; hay que **ordenar y paginar a la vez** sin traerse 11.426 filas; y el
**total viaja como columna** con `count(*) over ()`, porque una segunda consulta
solo para saber cuántas páginas hay es pagar dos veces el mismo filtro.

`p_sort` y `p_dir` **no se interpolan**: son una lista blanca resuelta con `case`
en el `order by`. Recibir el nombre de una columna desde una URL y meterlo en un
`execute format` es cómo se regala una inyección. Comprobado con
`p_sort = '; drop table artists'`: cae en el desempate por `id` y devuelve algo
estable.

Medido antes de escribirla: ordenar por nombre 314 ms, buscar «goya» 59 ms,
contar el filtrado 48 ms. El índice trigram sobre `immutable_unaccent(name)` de
0001 ya cubría la búsqueda, así que no hizo falta ninguno nuevo.

**La 0035 existe porque la 0034 se quedó corta** —dejaba ordenar por dos
columnas de cuatro— y no se reescribió la 0034 a propósito: ya estaba aplicada
en la base de verdad y `migrate` guarda su checksum. Cambiarle el fichero la
dejaría marcada como distinta para siempre en `--status`, que es el aviso que un
día servirá para detectar una migración manipulada.

### Dos cosas que solo se vieron mirando la pantalla

**Los años antes de Cristo salían «-1809–-1749»**, porque el guion de separación
y el signo son el mismo carácter. Hay artistas del segundo milenio a.C. en el
catálogo —Hammurabi—, así que no es un caso de laboratorio. De ahí
`formatYears()`, que además no usa `Intl.NumberFormat` para el año: pondría el
separador de millares y «1.828» no es un año, es una cantidad.

**En el móvil se salía de la pantalla la columna de obras**, justo el dato por el
que la tabla viene ordenada. La tabla se desliza, pero un dato que hay que
buscar deslizando es un dato que no está. Se esconde por debajo de 560 px la
columna que menos añade: el país en museos —la ciudad ya lo dice casi siempre— y
la nacionalidad en artistas. Comprobado con capturas a 390 px.

**Los enlaces van en una fila propia bajo la cabecera**, no en la barra de
arriba: allí ya se reparten el sitio el logo, el buscador y tres idiomas, y en
un teléfono de 390 px al buscador le quedaban 40 px. Dos enlaces más lo dejarían
otra vez sin espacio.

### Filtros de artista y la lista de movimientos

Pedido a continuación: «filtrar autor por nacionalidad o fecha» y «una lista de
movimientos».

**Nacionalidad, en desplegable y no en texto libre.** Sale de Wikidata como
etiqueta cerrada, así que escribir «Holanda» no encontraría «Dutch Republic».
Son 220 distintas, ordenadas por número de artistas —lo que alguien busca está
casi siempre entre las diez primeras, y 81 tienen un solo artista—. Se compara
por igualdad y no con `ilike`: un `ilike` haría que «Netherlands» arrastrara
«Southern Netherlands», que es otro sitio y otro siglo.

**La fecha es el AÑO DE NACIMIENTO**, no el de muerte ni un solapamiento de
vidas. Es lo que se entiende por «un artista del XVII» y lo que cabe en una
etiqueta de formulario. Admite negativos porque el catálogo va de -1809 a 2006.
Un artista sin año —589 de 11.426— desaparece al pedir un rango, y es lo
correcto: de quien no se sabe cuándo nació no se puede afirmar que esté dentro.

Comprobado que se combinan y estrechan: 11.426 → 531 holandeses → 383 nacidos en
el XVII → 115 que además llevan «van».

**Ojo con `create or replace` al añadir parámetros.** Postgres identifica una
función por sus argumentos, así que la 0036 con tres parámetros más no habría
reemplazado nada: habría creado una SEGUNDA `list_artists`, y una llamada con
seis argumentos seguiría cayendo en la vieja —la que no filtra— sin dar error.
De ahí el `drop function` explícito antes del `create`.

**Movimientos** (`/es/movimientos`): 187 con obra, tabla ordenable por nombre o
por número. Cada fila lleva al buscador ya filtrado y no a una ficha propia,
porque una ficha de movimiento sería el buscador filtrado con otro nombre. Eran
el único eje del catálogo sin página: se podía filtrar por movimiento, pero solo
eligiendo de un desplegable de cuarenta, así que los otros 147 no existían.

**Sin columna de época, y no por olvido**: `movements` tiene `start_year` y
`end_year` y están **a null en los 187**. La ingesta nunca los pidió a Wikidata.
Se quitó la columna en vez de dejarla vacía, que parecería un dato que falta en
vez de un dato que no se trae. Rellenarlos es trabajo de ingesta (P580 y P582).

**Las etiquetas de la barra son cortas** —«Museos», no «Todos los museos»—:
con cuatro secciones las largas se salían de un teléfono de 390 px y «Buscar»
quedaba cortado contra el borde. La mayúscula la pone el estilo, para no
duplicar siete traducciones por una letra.

**Queda sin resolver**: las nacionalidades vienen de Wikidata en inglés y sin
traducir —«Kingdom of Pergamon», «Tang dynasty»— y muchas son estados históricos
que ya no existen. El filtro por museo en el buscador sigue sin existir. Y los
años de los movimientos, que hay que traer de Wikidata.

**La chincheta, de `<button>` a `<a href>`.** El clic normal se sigue
interceptando para que la navegación sea instantánea, pero con Ctrl, Cmd,
Mayúsculas o botón central se aparta: quien pide una pestaña nueva quiere una
pestaña nueva. Comprobado con Playwright sobre la app construida: 48 chinchetas,
todas `<a>` con dirección, y el clic navega sin recargar.

**Queda pendiente** el filtro por museo en el buscador, que hoy no existe: se
puede filtrar por ciudad pero no por un museo concreto.

---

## Cuentas, favoritos y corregir desde la web (1 de septiembre)

**La tabla `favorites` ya existía desde `0001_init`**, con la forma correcta y
cero filas: llevaba desde el principio esperando una pantalla. Conviene mirar
las migraciones antes de escribir una — la 0037 se escribió entera creándola y
falló con «relation already exists». Lo que sí faltaba y añade: dos índices y
`my_favorites`, que trae la lista con los textos ya en el idioma de quien mira.

**La entrada se mudó de `/admin/entrar` a `/entrar`**, porque ya no es del
panel: desde que hay favoritos se identifica cualquiera. La ruta vieja queda
como redirección —está en enlaces y en `ver-panel.mjs`, y una URL que alguien
pudo guardar no se borra, se reenvía—.

**Contraseña además del enlace al correo, no en su lugar.** El enlace es lo
bueno para quien entra dos veces al año: nada que recordar, y registrarse es lo
mismo que entrar. La contraseña es para quien entra a diario, porque esperar un
correo para corregir un título es fricción pura. Nadie tiene contraseña hasta
que se la pone en `/entrar/clave`, ya dentro: así no hay que inventarle una a
nadie ni mandarla por ningún canal.

**El admin corrige desde donde ve el fallo.** Enlace «Corregir» en la ficha
pública de una obra cuando quien mira administra, y —lo que faltaba de verdad—
en la bandeja de hallazgos: llevaba a la ficha PÚBLICA, o sea que veías el
problema y tenías que ir al panel, buscar la obra otra vez y abrir su
formulario. Una bandeja de revisión sin el botón de arreglar es una lista de
quejas.

`viewerIsAdmin()` decide qué se PINTA y no qué se puede hacer: quien fuerce la
URL del formulario se topa con `requireAdmin`, y quien llame a la base
directamente, con las políticas.

### El botón de favorito: tres intentos hasta dar con la forma

Empezó siendo un formulario de servidor puro, que es lo coherente con el resto
de la app. **No funcionaba: la base guardaba bien y el botón seguía diciendo
«Guardar».** Una pantalla que miente sobre lo que acaba de guardar es peor que
una que no guarda.

Lo que se probó y NO lo arregló, por orden:

1. `revalidatePath` de la ruta. La respuesta de una acción de servidor se pinta
   reutilizando la carga que el cliente ya tenía de esa página.
2. Separar lectura de escritura. Aquí sí había un fallo real y se queda
   arreglado: `esFavorita` vivía en un fichero con `'use server'` en la primera
   línea, y eso convierte en acción de servidor **todo** lo que exporta,
   incluida una función que solo lee. La regla que queda: `'use server'` marca
   lo que MUTA; lo que se lee al renderizar es un módulo normal.
3. Desactivar la caché de `fetch` en el cliente de Supabase. También se queda,
   y también por su propio motivo: Next memoiza los `fetch` idénticos dentro de
   una petición, y una acción y el render que la sigue son la misma petición.
   Además, **todo lo que lee ese cliente depende de quién mira**: una respuesta
   cacheada ahí es la de una persona servida a otra.
4. `redirect` a la misma ruta. Unas veces bien y otras devolvía una página a
   medias, sin un solo error en el servidor.

Lo que sí: **componente de cliente con `useOptimistic`**. Un interruptor por
usuario no encaja en el molde de «todo servidor»; el estado lo lleva la pantalla
al instante y el servidor confirma después, y si la escritura falla React
revierte solo. Sigue siendo un `<form>` con una acción de verdad, así que sin
JavaScript el botón funciona igual: se pierde la respuesta instantánea, no la
función.

**Y una lección de método, que costó más que el fallo.** Media hora se fue
persiguiendo un fallo que no existía: la prueba esperaba a `networkidle` después
de pulsar, y con una acción de servidor la página nunca deja de estar «idle»,
así que leía el DOM de antes. **Antes de dar por roto el código, comprobar que
la prueba mide lo que cree medir.**

---

## Lo hecho en la web el 29 de agosto (tarde): el color y el mapa

No estaba escrito en ningún sitio y son siete commits. La idea, que está en la
cabecera de `globals.css` y conviene no perder:

**La pantalla es papel —blanco roto, no blanco de pantalla— y tinta; el color lo
ponen las obras.** Pero queda UN acento, un burdeos que tira a naranja
(`#bf5320`), y tiene un trabajo concreto: señalar dónde se pulsa y dónde está
algo en el mapa. Al no haber ningún otro color compitiendo, funciona como la
línea roja del suelo de un museo: se sigue sin pensarlo. **La regla para no
volver a llenar esto de color: el acento marca acción o posición, nunca
decora.**

**El azul del sistema era el único color que nadie había elegido.** Los
desplegables, las casillas y el texto seleccionado los pintaba el navegador de
azul, y chillaba justo al lado del burdeos. Se sustituye por una salvia
(`--seleccion: #afcca5`), casi opuesta al acento en el círculo, que se lee como
«esto está elegido» sin robarle el papel.

Y una lección de contraste que costó tres intentos: **la salvia clara lleva
texto OSCURO**, y por eso puede ser tan clara. Con blanco encima se queda en
1,6:1 —invisible—; con negro sube a 10,4:1. Por eso el color de ese texto tiene
su **propio token** (`--seleccion-texto`) en vez de usar `--text`: en modo
oscuro `--text` es claro y sobre ese verde desaparecería. El verde es el mismo
en los dos modos porque es una marca de rotulador, y un rotulador no cambia de
color al apagar la luz.

**El mapa, que sea papel y no un callejero.** Se le quitó el mapa base de
calles: lo que importa es dónde hay museos, no cómo llegar en coche. Las marcas
son **cuadradas y de un solo tamaño** —una chincheta que crece con el número de
obras convierte el mapa en un gráfico de burbujas y se lee mal—. Sin sombras y
sin esquinas redondas: una esquina redonda insinúa un botón de sistema
operativo, una recta no dice nada, que es lo que se busca (`--radius: 0px`).

---

## Lo siguiente, en orden

*Puesto al día el 1 de septiembre de 2026. Los puntos 0, 0 bis, 1 y 2 de esta
lista estaban hechos y seguían escritos como pendientes: al retomar, fiarse de
las secciones «HECHO», que llevan fecha.*

**~~0. La aplicación de ingesta.~~** Hecha entera: ver la ingesta, pedirla y
pararla desde la web, y corregir el catálogo a mano —obras, artistas, museos,
movimientos y los textos de cada idioma—.

**~~0 bis. La Galería Nacional de Arte.~~** Entró entera el 29 de agosto:
48 de 48 museos, ninguno a medias.

**~~1. Imágenes desde la API del museo.~~** Hecho para el Nationalmuseum el 1 de
septiembre: 9.894 imágenes rellenadas y publicadas. **Sigue siendo el único
conector de imágenes que existe**; los demás museos están en la lista de «algún
día» del final, y Manuel decidió el 28 de agosto que no bloqueen el trabajo en
la aplicación.

**~~2. Las imágenes sin verificar.~~** Hecho: la verificación pasó de tres días
y medio a minutos preguntándole a Commons de 50 en 50.

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

- **Reanudar sola dentro de un museo.** El checkpoint por museo ya existía; el
  estado *dentro* de un museo se ve ahora, pero al reanudar se rehace entero.
- Las filas de `ingest_runs`/`ingest_steps`/`jobs` no se borran nunca. Son
  diminutas (~48 filas por barrido), pero si algún día molestan, la retención
  es trivial.

### 1 bis. Pedir los trabajos desde la web — HECHO el 29 de agosto (tarde)

Migración **0027**, `packages/ingest/src/worker.ts`, `trabajador.cmd` y la
pantalla `/[lang]/admin/ingesta`, que ahora es la consola de operaciones.

**Cómo se usa**: doble clic en `trabajador.cmd` (déjalo abierto) y desde
`/es/admin/ingesta` se piden los trabajos: añadir o actualizar un museo,
barrido completo, buscar imágenes, publicar, auditar, recalcular contadores y
comprobar la base. Se ven en cola, en curso —con las últimas líneas de su
salida en vivo— y terminados, y se pueden parar.

**El reparto, que es la decisión de fondo.** Un barrido dura horas y Vercel
corta las funciones a segundos; alojar algo que aguante horas cuesta dinero, y
el plan gratuito es una restricción del proyecto. Así que **la web encarga, la
máquina de casa ejecuta y la tabla `jobs` es el buzón**. Si no hay trabajador
escuchando, el encargo espera; no se pierde.

**La regla de seguridad, que no se puede relajar:** `kind` es una lista cerrada
en la propia tabla, y los argumentos son **datos, nunca una orden**. El
trabajador traduce cada `kind` a un comando fijo que él conoce y valida cada
argumento. Sin eso, un formulario web sería un intérprete de comandos. Se
comprobó de las cuatro maneras: el anónimo no puede llamar a `request_job`; un
`kind` inventado lo rechaza la restricción de la tabla; insertar en `jobs`
saltándose la función lo rechaza RLS; y argumentos envenenados
(`Q1 --force; del *`, `; drop table artworks`) los para el trabajador y dejan
el encargo en `failed` sin ejecutar nada.

**Y dos cosas que se aprendieron a base de romperlas:**

- **Se lanza `node` directamente, no `npm`.** En Windows `npm` es un `.cmd` que
  abre un `cmd.exe` que abre el `node`: matar el envoltorio deja al nieto vivo
  y escribiendo en el catálogo.
- **Parar es pedirlo, no matarlo.** A la ingesta se le levanta la bandera y sale
  entre museos. Probado en vivo: barrido corriendo, parada pedida en el museo
  22, salida limpia en el 36 con todo marcado `cancelled` y ningún museo a
  medias.

`trabajador.cmd` es deliberadamente tonto —`chcp`, el PATH del Node bueno y un
bucle que lo relanza a los 10 s— porque `reanudar-ingesta.cmd` intentó ser
listo con PowerShell y nunca llegó a lanzar un barrido. Este se probó
lanzándolo y comprobando que el proceso existe.

### 2. Editar el catálogo a mano — HECHO el 29 de agosto (tarde)

Migraciones **0028-0031**, `/[lang]/admin/corregir` y sus dos fichas.

**La regla, que era lo que había que decidir antes de escribir nada: la persona
gana en el campo que ha tocado, y solo en ese. Wikidata gana en todo lo demás.**
No es un término medio cobarde: son 148.000 obras y nadie va a mantenerlas a
mano, así que la fuente tiene que seguir mandando por defecto; pero una
corrección hecha a conciencia no puede deshacerse sola en el siguiente barrido,
porque eso convierte los formularios en trabajo que se tira.

Cómo se hace cumplir, y dónde: **en un disparador de la base**, no en la
ingesta. Podría resolverse leyendo `locked_fields` antes de cada upsert, pero
entonces la regla dependería de que todo el que escriba se acuerde. Así la base
restaura el valor corregido venga de donde venga.

- `artworks.locked_fields` y `artists.locked_fields`: los campos tocados a mano.
- **El estado va aparte, por `status_locked` (0008)**, que ya existía con el
  mismo razonamiento. Un concepto, un guardián: tener dos gobernando el mismo
  campo es la clase de duplicidad que dentro de seis meses no sabe nadie cuál
  manda.
- Se guarda **solo lo que ha cambiado de verdad**. Si se enviaran los diecisiete
  campos, abrir el formulario y darle a guardar congelaría la ficha entera
  frente a Wikidata.
- Cada campo defendido lo dice en la propia ficha, con una casilla al lado para
  soltarlo. Una regla invisible se descubre el día que algo no cambia y nadie
  entiende por qué.

**Comprobado en el navegador**, no solo en SQL: crear una obra a mano, corregir
su título, que una escritura de la ingesta por encima NO la pise, soltar un
campo y que la fuente vuelva a mandar en él, corregir dos veces el mismo campo
(que era el caso que habría fallado en silencio), y que el anónimo y los campos
que no tocan queden rechazados.

**Tres tropiezos que dejaron migración:**

- 0028 casteaba todo a `text` y `year_start` es `integer`: no se podía corregir
  ningún campo numérico. Ahora el tipo se le pregunta al catálogo (0029).
- 0028 listaba campos escritos de memoria —`title_es`, `genre`, `description`,
  `bio`— que no existen. Los nombres reales, en 0030.
- El buscador hacía `title ilike '%…%'` desde la web: **25-34 s y fallo
  silencioso**. El índice `artworks_title_trgm` no servía —está sobre
  `immutable_unaccent(title)` y además es parcial, solo publicadas— así que era
  un escaneo secuencial que se pasaba de los 3 s y devolvía `null`, que la
  pantalla pintaba como «no hay nada». Ahora va por función indexada (0031) y
  los fallos se enseñan.

**Límite conocido y a la espera de arreglo**: por título no se llega a las obras
que esperan datos, porque se guardan sin traducciones (130 de 71.244 las
tienen). A esas se llega por su número de ficha o su QID, y la pantalla lo dice.
**El arreglo**: cambiar `artworks_title_trgm` —parcial y que **nunca se ha
usado**, `idx_scan = 0`, 12 MB— por uno completo, ~40 MB. No se hizo en el
momento porque había una ingesta de 121.000 obras escribiendo y construirlo la
habría frenado.

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

## HECHO: corregir el catálogo entero a mano (29 de agosto, noche)

Manuel encontró tres fallos mirando la app: el artista salía como «Jerónimo
Bosch» y en español se dice **El Bosco**; el Louvre estaba en
**Saint-Germain-l'Auxerrois** y el MNAC en **Montjuïc**. Ninguno de los tres se
podía arreglar con lo que había.

**Lo que enseñó el primero.** La app pública NO pinta el campo canónico, pinta
`coalesce(traducción, canónico)`. Como hasta entonces solo se editaba lo
canónico, se podía escribir «El Bosco» en `artists.name`, guardar, y seguir
viendo «Jerónimo Bosch» en la ficha sin ninguna pista de por qué. **Corregir sin
efecto visible es peor que no poder corregir.** De ahí el bloque «Los textos,
idioma a idioma» que ahora lleva toda ficha.

**Lo que enseñó el segundo, midiendo antes de construir.** No es un museo
suelto: de los 30 con más obras, **18 tenían como ciudad un barrio, un distrito
o un municipio** —Manhattan, Innere Stadt, City of Westminster, Bezirk Mitte,
«municipio de Estocolmo»—. Sale de `wdt:P131`, que da la entidad administrativa
INMEDIATA. Se podría subir por la cadena de P131 hasta dar con algo de clase
«ciudad», pero **son 48 museos**: la lista entera cabe en una pantalla. Cuando
sean 500, se automatiza. Por eso `renombrar_ciudad()` cambia la ciudad en TODOS
los museos que la comparten: «City of Westminster» son cuatro museos de Londres
y arreglarlos de uno en uno deja el filtro público ofreciendo dos sitios donde
hay uno.

**Migración 0033.** `locked_fields` y el disparador de 0028 en instituciones,
movimientos y las cuatro tablas de traducción; `editar_ficha()` para museos y
movimientos, `editar_traduccion()` para los textos de cualquier entidad en
cualquier idioma (crea la fila si no existe), y `renombrar_ciudad()`. La lista
blanca vive en `campos_editables(tabla)`: sin ella, recibir el nombre de la
tabla desde un formulario sería poder escribir en cualquier tabla del esquema.
`slug` y `location` quedan fuera a propósito —el primero es la URL pública, el
segundo está copiado en cada obra del museo—.

En `artwork_translations` el nombre del disparador importa: `respetar…` va antes
que `…search_update` por orden alfabético, que es justo lo que hace falta —
primero se restaura el título corregido y después se indexa ESE título.

**Pantallas.** `/es/admin/catalogo` es el menú; museos, ciudades y movimientos
tienen lista completa, los artistas van de cien en cien y las obras siguen
entrando por el buscador (son 269.000). Las listas existen para lo que el
buscador no puede hacer: **encontrar lo que está mal sin sospecharlo antes.** Lo
de las ciudades no se descubrió buscando ningún museo, se descubrió mirando la
lista entera de un vistazo.

**Comprobado por el camino del usuario**, con `next start` en el 3112 y un
navegador con sesión de administrador: las siete pantallas responden, se edita
un campo y se guarda, se suelta y vuelve a mandar Wikidata, y una escritura con
`service_role` —la ingesta— **no pisa** lo corregido pero **sí** cambia lo que
nadie tocó. La ficha pública del Bosco ya dice «El Bosco» y la del MNAC,
Barcelona.

---

## HECHO: las ciudades, corregidas (31 de agosto de 2026)

Eran quince, no dieciséis, y salieron de medir la lista entera en vez de fiarse
de la de la noche anterior: **38 ciudades → 34**, 20 museos tocados. Innere
Stadt → Vienna, City of Melbourne → Melbourne, Brussels-Capital Region →
Brussels, Bezirk Mitte → Berlin, Maxvorstadt → Munich, Copenhagen Municipality →
Copenhagen, 7th arrondissement of Paris → Paris, City of Westminster y London
Borough of Southwark → London, City of Edinburgh → Edinburgh, Roma Capitale →
Rome, Firenze → Florence, Ueno-kōen → Tokyo, Stockholm Municipality →
Stockholm, Manhattan → New York City. Cada una con su nombre en es, en y fr,
que es lo que se lee.

Cuatro eran fusiones y cuadraron solas: Londres tiene ahora 5 museos, Nueva
York 4, París 3, Florencia 3, Múnich 2.

**No se hizo con un UPDATE.** Fue por `renombrar_ciudad()`, la misma función que
llama el formulario, porque la marca en `locked_fields` es lo único que impide
que el siguiente barrido lo deshaga. Esa función exige `is_admin()`, así que
hace falta una sesión de verdad: se pide un enlace de acceso con la
service_role, se canja con `verifyOtp({ token_hash })` y se llama a la RPC con
esa sesión. Es el camino del usuario sin navegador, y sirve para cualquier
corrección masiva futura. Ojo: `token_hash`, no `email` + `token` — lo que
devuelve `generateLink` ya viene resumido y por la otra puerta se compara contra
el código de seis cifras, que da «Token has expired or is invalid».

Se hizo **una primero** —Ueno-kōen, la más pequeña— y se comprobó entera antes
de lanzar las catorce: lo canónico, los tres idiomas (el `es` no existía y lo
creó), la marca a los dos niveles y el filtro público respondiendo.

Comprobado al terminar, contra la misma `search_artworks` que llama la app: los
nombres nuevos devuelven obras y **los viejos devuelven cero**. Y por el camino
del usuario, con `next dev` en el 3112: `/es/buscar?pais=GB&ciudad=London`
filtra y rotula «Londres».

**De propina, midiendo**: el Van Gogh Museum tenía `country` = Netherlands y
`country_code` vacío, así que se caía de cualquier filtro por país. Corregido a
NL por la misma puerta.

**Lo que sigue mal y no se tocó.** Las filas de `de`, `it`, `nl` y `pt` todavía
dicen «Manhattan» y «Saint-Germain-l'Auxerrois»: no son idiomas de la app hoy,
pero volverán a verse el día que se reactiven. Y esto es una corrección museo a
museo, no una regla: **un museo nuevo de Nueva York entrará otra vez como
«Manhattan»** y volverá a partir el filtro en dos. Mientras sean 48 museos se
mira la lista y ya; cuando sean 500, hay que subir por la cadena de `P131`.

---

## HECHO: las imágenes, y lo que costó verlas (1 de septiembre de 2026)

**9.894 imágenes rellenadas y publicadas.** El catálogo pasa de 125.367 a
**135.261 obras publicadas**. Salieron de cruzar las 23.214 obras del
Nationalmuseum que esperaban con las 88.208 de su catálogo que tienen imagen y
número de inventario.

**El conector llevaba desde el 28 de agosto escrito y sin ejecutar, y estaba
roto.** Construía las URLs con ancho 1280 y ese servidor IIIF **devuelve 501 a
ese ancho siempre**: es de nivel 1 y solo sirve anchos cerca del mayor tamaño
que declara cada imagen, que varía —se midieron topes de 800, 700 y menos de
700 en tres obras—. Se habrían escrito ~11.000 imágenes rotas sin que nadie lo
notara hasta abrir una ficha, y con el agravante de que esas obras ya no
vuelven a la cola de las que esperan. Ahora usa el original (`full/full`), que
respondió en las 24 de la muestra y pesa 0,1-0,2 MB porque vienen ya
comprimidas. También recorta la barra final de la base, que traían las 24.

**Y se le puso el seguro que faltaba**: antes de escribir nada comprueba que
veinte imágenes repartidas cargan de verdad, y si alguna falla aborta sin tocar
la base. Es lo que habría cazado esto solo.

De paso se volvió a medir la premisa del conector, que era de agosto: no es el
51,4% de objetos cruzables sino el **33,6%** (1.234 objetos de trece páginas).
**Ojo con la página 1 de esa API**, que es atípica: sus cien objetos no tienen
número de inventario y solo uno trae imagen, así que una sonda que mire solo el
principio concluye que la API se ha roto.

### La verificación pasó de tres días y medio a media hora

La comprobación de imágenes descargaba una a una. Medido: **Wikimedia deja
pasar unas once peticiones seguidas y a partir de ahí devuelve 429 en el acto**,
así que con los reintentos la media era de 3 s por imagen. Las 125.000 del
catálogo eran **tres días y medio de máquina**. Una noche entera dio 10.000
comprobadas, todas correctas.

Ahora se le pregunta a la API de Commons por **50 ficheros en una petición**:
dice si cada uno existe y cuál es su miniatura de 500 px. **10.000 imágenes en
4 minutos**, unas cien veces más rápido.

Dos cosas que hubo que medir para que el veredicto no mintiera:

- **Comparar las URLs enteras da 100 de 100 distintas siendo todas la misma
  imagen.** Commons devuelve hoy `thumb.wikimedia.org` con parámetros de
  seguimiento donde nosotros construimos `upload.wikimedia.org`, y codifica los
  paréntesis que nosotros dejamos literales. Se comparan **rutas
  decodificadas**.

- **Una ruta distinta no es una imagen rota.** Para un `.tiff` Commons prefiere
  `lossless-….png` y nosotros pedimos `lossy-….jpg`; para un `.webp` él añade
  `.png`. Comprobado a mano: **las dos cargan**. Pero tampoco se puede dar por
  bueno sin mirar, porque el fallo que dejó 86 obras sin imagen era exactamente
  un sufijo mal construido. La salida: comprobar **una por extensión** y aplicar
  el veredicto a su grupo, que el sufijo lo decide la extensión.

Lo que no es de Commons —las 9.894 del Nationalmuseum, tres del Met— sigue por
descarga directa: son pocas y sus servidores no nos limitan.

### El susto del espacio: 121 MB en decir lo que ya sabíamos

La base llegó a **495 MB de los 500** del plan. Lo que había crecido era
`audit_findings`: 121 MB —59 de tabla y 62 de índices— con 276.227 filas. Y
**275.885 de ellas eran tres reglas de bulto**: `image_missing` (143.790),
`artist_missing` (68.851) y `date_missing` (63.244), una fila por obra
repitiendo lo que la propia obra ya dice. `image_missing` es literalmente
`status = 'pending'` sin `image_url`. Se estaba pagando **el 24% de la base**
por un dato duplicado.

Ahora esas tres se cuentan en el resumen y no se guardan fila a fila. Borradas
las existentes y compactada la tabla: **495 → 374 MB**, `audit_findings` de 121
MB a 200 kB, y quedan los 342 hallazgos que sí piden mirada humana. No se perdió
nada de nadie: había **0 hallazgos con `reviewed_by` y 0 con nota** en 276.227.

### Tres tropiezos de la noche, para no repetirlos

**Una condición de espera que se dispara antes de tiempo es peor que no
esperar.** El encadenado de la noche buscaba en el log de `fill-images` la línea
«obras encontradas con imagen», que se imprime ANTES de escribir. `promote`
corrió cinco minutos antes de tiempo y publicó cero. Hubo que repetirlo a mano.
Si se espera a un proceso, hay que esperar a la línea que solo existe cuando ha
terminado de verdad.

**`--image-budget 3000` comprobaba 1.000.** PostgREST devuelve 1.000 filas como
mucho y el `.limit(3000)` se aceptaba sin rechistar. Un parámetro que miente en
silencio es la peor clase de fallo: la traza decía «Comprobando 1000» y nadie
lo miraba. Ahora se pide por páginas, con desempate por `id` —sin él, ordenar
por una columna nula en decenas de miles de filas deja el orden a criterio del
planificador y dos páginas pueden repetir obras y saltarse otras—.

**Estimar el ritmo por la configuración en vez de medirlo.** Se dijo «dos a la
vez cada 400 ms, o sea ~2,9 img/s, o sea 12 horas» y el ritmo real era 0,33
img/s y 3 días y medio. La configuración dice lo que se pide, no lo que el otro
lado concede. Medir una muestra habría costado dos minutos.

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

**`ANALYZE` después de una ingesta grande.** Tras meter 100.000 filas, Postgres
seguía planificando como si la tabla tuviera 6.000. Ahora lo hace la propia
ingesta al terminar, porque es ella quien ensucia las estadísticas.
