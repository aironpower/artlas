# Notas de trabajo

Estado al 28 de agosto de 2026 y lo siguiente a hacer.

---

## Dónde nos quedamos

El catálogo pasó de **6.161 obras a 113.783** en un barrido de 9 h 36 min sobre
los 48 museos. Lo que cambió no fue solo el tamaño: cambió la idea. Antes se
descartaba lo que no se podía enseñar; ahora se guarda todo y una columna dice
qué es visible.

| | |
|---|---|
| Obras en total | ~124.600 |
| Publicadas (visibles en la app) | ~62.000 |
| Esperando datos | ~62.000 |
| Rechazadas (no son obras) | 2 |
| Espacio | ~160 MB de los 500 del plan gratuito |
| Idiomas | es, en, fr (eran 7; se recortó por espacio) |

Migraciones `0001`–`0022`. **Ya no se aplican a mano**: `npm run migrate`.
Quedan DOS sin aplicar, `0017` y `0021`, y el motivo está más abajo.

Hay además un **panel de revisión** en `/[lang]/admin`, con acceso por enlace
al correo. `manuel@softie.dev` ya es administrador.

### LO PRIMERO AL RETOMAR: mirar el barrido

El 28 de agosto por la tarde quedó corriendo el barrido de los cuatro museos que
se habían quedado a medias (Viena, Bélgica, Filadelfia y el **Met**, que es el
largo). Va suelto, sin depender de ninguna sesión, y escribe en
`ingesta-barrido.log`, en la raíz. Lo primero es ver si terminó y si algún museo
se cayó:

```bash
tail -40 ingesta-barrido.log
```

Los otros 44 museos se saltan solos. Estos cuatro se rehacen porque su
checkpoint era de umbral 2 y ahora se pide 0.

Ya hecho antes de lanzarlo, no hay que repetirlo:

- **Las 22 migraciones están aplicadas** (`migrate --status` lo confirma).
- **Movimientos fusionados**: quedaban 215, ahora 214. Solo había un duplicado
  (*Gothic art* → *Gothic painting*).
- **Los 198 artistas con nombre-URL, borrados**. Solo 28 tenían obras; esas 28
  obras quedaron anónimas, que es lo correcto. Las claves ajenas hicieron el
  trabajo: `on delete set null` en `artworks` y `on delete cascade` en las
  traducciones.

Cuando el barrido termine:

```bash
cd packages/ingest
npm run fill-images                # en seco: cuántas encontraría
npm run fill-images -- --apply     # Nationalmuseum: 23.214 obras esperando
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
3. **La cabecera repite el buscador grande** en todas las páginas, incluso
   dentro de una obra.
4. **Los títulos arrastran ruido de Wikidata**: «El columpio (Goya)», con el
   pintor repetido justo debajo.
5. **Las transiciones entre vistas**, que era lo que Manuel pedía junto al
   estilo: View Transitions, esqueletos de carga y precarga al pasar el ratón.

---

## Lo siguiente, en orden

**1. Imágenes desde las APIs de los museos.** De las ~62.000 que esperan,
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

**3. Terminar el panel.** Ya hay bandeja de hallazgos con confirmar y descartar.
Falta: alta manual de obras, y publicar o retirar una obra a mano (que necesita
su política de escritura sobre `artworks`, con `status_locked` para que la
ingesta no pise la decisión).

**4. Ingesta incremental.** Reingerir un museo vuelve a hidratar TODAS sus obras
desde Wikidata aunque ya las tengamos idénticas. Saltarse los QID ya conocidos
haría que añadir museos nuevos costara solo lo nuevo. Es lo que más rendiría de
cara a seguir metiendo museos.

**5. Rotar la contraseña de la base**, que pasó por una conversación.

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
