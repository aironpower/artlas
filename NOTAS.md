# Notas de trabajo

Estado de Artlas al **3 de septiembre de 2026** y lo siguiente a hacer.

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

Cifras **comprobadas contra la base el 3 de septiembre**, no heredadas de la
sesión anterior (`npm run check-db`, `migrate -- --status` y una consulta
directa de estados). Las de obras, imágenes y artistas no se tocaron ese día
—solo se leyeron—, así que siguen siendo las del 2:

| | |
|---|---|
| Obras | 269.159 · **135.258 publicadas**, 133.899 esperando datos, 2 rechazadas |
| Imágenes | 135.258 verificadas · **0 rotas, 0 sin comprobar, 0 publicadas sin imagen** |
| Artistas | 21.619 en la tabla · **11.426 con obra publicada** |
| Museos | **48 de 48**, en 34 ciudades |
| Movimientos | 224 en la tabla · 186 con obra publicada |
| Hallazgos abiertos | 43 (de 344; los otros 301 ya revisados) |
| Migraciones | `0001`–`0047` · **46 aplicadas, 1 pendiente** (la `0047`) |
| Espacio | **406,6 MB** de los 500 del plan gratuito (81,3%) |
| De eso, índices | **206,6 MB: más que las tablas** (200,0 MB). 46,6 MB sin usar |

**Lo primero, siempre: comprobar que no hay nada corriendo.** Tocar el catálogo
con una ingesta viva ya tumbó un museo entero. En PowerShell,
`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"` y mirar si alguna
línea de comandos lleva `cli.ts`.

**Ojo al espacio antes de meter un museo grande.** El margen es la MITAD de lo
que se venía diciendo: `artworks` y sus índices son 297 MB para 269.159 filas
—1,10 KB por obra, y ~1,7 KB si está publicada y lleva traducciones—, así que
los 93,4 MB libres dan para **unas 60.000 obras, no 105.000**. Los 0,89 KB con
los que se calculaba antes se quedaban cortos (medido el 3 de septiembre). Y **desconfiar de lo que crece sin ser el catálogo**: el
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

**Tres huecos cerrados el 2 de septiembre** —desde el panel se puede añadir un
museo que no esté en la semilla, la pantalla dice si hay trabajador escuchando,
y el museo se busca por su nombre en vez de teclear el QID—. Tienen su sección
en el historial.

**Lo que falta para poder delegarlo de verdad ya no es teclear identificadores:**

- **Un museo nuevo no está hecho cuando acaba la ingesta**, sino cuando alguien
  repasa su ficha en `/es/admin/catalogo` —ciudad, país, nombre en es/en/fr—.
  Hoy eso es algo que sabe Manuel y no dice ninguna pantalla. Para delegarlo
  tiene que ser una lista guiada: qué mirar, en qué orden, y cómo se marca un
  museo como revisado. El buscador ya avisa de que hay que hacerlo («museo
  nuevo · hay que repasar su ficha a mano»), pero avisar no es guiar.
- **Un rol.** El panel es `requireAdmin` a secas: delegar hoy es hacer
  administrador a otra persona, con todo lo que eso abre.

Y el aviso que no se puede olvidar antes de invitar a nadie: **quedan ~93 MB**,
unas 60.000 obras. Un museo grande se los come.

### 2. Cabos conocidos, de un rato cada uno

- **Las obras que cambian solas.** Unas 4.500 del catálogo declaran varios
  valores para la misma propiedad en Wikidata (dos materiales, dos fechas) y
  SPARQL no garantiza el orden, así que la ingesta se queda con uno u otro en
  cada pasada. Se arregla **ordenando los valores antes de elegir**, como ya se
  hizo con las fechas de los movimientos. Coste conocido y acotado, no una fuga.
- **Los índices que no lee nadie: la `0047` está escrita y sin aplicar.**
  Medido el 3 de septiembre contra `pg_stat_user_indexes`, con estadísticas
  desde el 20 de agosto: cuatro índices con `idx_scan = 0` suman **46,6 MB**
  —`artworks_title_trgm` (25 MB), `artworks_inventory_idx` (9,45),
  `artworks_slug_idx` (8,87) y `artist_translations_name_trgm` (3,27)—. Ninguno
  es primario ni único. Aplicarla baja al **72,0%** del plan.

  Los dos hallazgos nuevos: `fill-images.ts` cruza los inventarios **en memoria**
  y no por SQL, y las obras se sirven por `/obra/[id]`, así que su slug se lee
  pero nunca se busca. Tirar `artworks_title_trgm` no cierra la puerta al índice
  completo (~40 MB) si algún día se quiere corregir por título las 134.000 que
  esperan: se crea entonces, con el hueco ya recuperado.

  **Pide ingesta parada**: `drop index` toma un bloqueo exclusivo breve sobre
  `artworks`, y no puede ser `CONCURRENTLY` porque `migrate.ts` envuelve cada
  migración en una transacción. Pasa el `--dry-run`.

  Queda vigilado `artwork_translations_title_trgm`: 15 MB para 3 lecturas. No se
  tira porque esas 3 son el buscador funcionando.
- **Buscar y la lista de artistas siguen con botón de paginación**, mientras que
  la ficha de museo ya sigue sola al llegar abajo.
- **Las obras del radio son 60 como mucho**, las más destacadas. Con el buscador
  dentro ya no es una trampa —quien pregunta por un cuadro pregunta al
  servidor—, pero recorrer las mil que hay a 5 km de Barcelona sigue sin poder
  hacerse: haría falta paginar `artworks_near`, que hoy no acepta desplazamiento.
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

### 2b. Lo que quedó abierto de la caché (9 de septiembre)

El agujero grande está cerrado —las fichas de obra, artista y museo se sirven de
la caché, comprobado con `x-nextjs-cache: HIT`; la crónica y el porqué, en
[HISTORIAL.md](HISTORIAL.md)—. Lo que sigue vivo:

- **Las tres listas índice siguen dinámicas.** `/museos`, `/artistas` y
  `/movimientos` leen `searchParams` para su ordenación y sus filtros, así que
  se renderizan en cada visita. Son 9 URLs frente a 405.000, pero cuelgan de la
  barra de navegación de TODAS las páginas. De momento las cierra el
  `Disallow: /*?` del robots. Arreglarlas de verdad es mover el orden a cliente
  —`/museos` son 48 filas y `/movimientos` 186, se ordenan en el navegador sin
  tocar el servidor—; `/artistas` es harina de otro costal, con su búsqueda y su
  filtro por nacionalidad.
- **`/buscar` seguirá siendo dinámico**, y está bien que lo sea: los filtros SON
  la página. Por eso el robots lo cierra.
- **Las obras están fuera del sitemap**, con `OBRAS_EN_SITEMAP` en
  `lib/sitemap-datos.ts`. Encenderlo ofrece las ~405.000 URLs de golpe, y el
  primer barrido no cabe en el plan gratuito (200.000 escrituras de ISR).
  **Decidir el hospedaje antes de tocarlo** — ver la sección 5.
- **`/p/1` y `/p/abc` devuelven 200 con `noindex`** en vez de 404. Es cómo se
  comporta Next con `loading.tsx` y streaming, no algo nuestro, y el
  `notFound()` ocurre antes de tocar la base, así que no cuesta consultas.

**Las fichas caducan a las 24 horas, no a la hora** (subido el 10 de septiembre):
el catálogo solo cambia cuando lanzas una ingesta, y a una hora cada página que
un rastreador vuelve a pisar se regeneraba. **La purga es desplegar:** cada
despliegue estrena caché, así que el `git push` que sigue a una ingesta ya deja
el catálogo al día. Si algún día la ingesta corre sin despliegue detrás —cuando
se mude al VPS—, tendrá que avisar ella con `revalidatePath`. La portada sigue a
una hora: enseña doce obras al azar.

**Y lo que hay que recordar al tocar cualquier página pública:** leer una cookie
o `searchParams` en el árbol de una página la vuelve dinámica ENTERA, y un
`<Suspense>` alrededor no la salva —eso es lo que costó la factura de agosto—.
Y una ruta con segmento dinámico no llega a ser ISR sin `generateStaticParams`,
aunque tenga `revalidate`. **La prueba no es el build, es
`.next/prerender-manifest.json`:** la ruta tiene que aparecer en `dynamicRoutes`.

### 2c. Artlas ya NO está en Vercel (hecho el 10 de septiembre)

**Corre en un VPS de Hetzner, `<IP del servidor>`**, Debian 13, CX23. El manual
es [DESPLIEGUE-VPS.md](DESPLIEGUE-VPS.md) y los ficheros están en `despliegue/`.
La web y el trabajador son dos servicios de systemd; Caddy delante con
certificado de Let's Encrypt.

**Para publicar:** `ssh artlas-deploy /opt/artlas/despliegue/desplegar.sh`
(la entrada `artlas-deploy` está en el `~/.ssh/config` de la máquina de Manuel,
con la clave `~/.ssh/artlas-vps`).

**Queda una cosa en Vercel:** quitar `artlas.softie.dev` del proyecto `web`,
para que no haya dos sitios reclamando el mismo dominio. La cuenta puede
quedarse pausada, no cuesta nada.

**Por qué, y esto deroga lo que se dijo el 9:** arreglar la caché hunde las
invocaciones, la CPU y la transferencia de origen, pero **no las Edge
Requests** —una página servida desde la caché sigue contando una—. Con 1,9M
contra un tope de 1M, es probable que Hobby ya no diera, arreglado y todo. Y el
escalón siguiente de Vercel son 20 $/mes de golpe: no hay nada entre medias.

**Cloudflare se miró y se descartó**, aunque sean $5 y no $20: allí Next corre
sobre `@opennextjs/cloudflare`, y sin caché incremental sobre R2 el ISR se cae a
SSR en cada petición —o sea, el problema que se acaba de arreglar—. Esa caché
tiene fallos abiertos hoy (escrituras que fallan, 503 recurrentes). No se pone
la pieza recién arreglada encima de la menos madura.

En un VPS, en cambio, `next start` es nativo y el ISR va a disco: funciona
exactamente como se verificó en local.

**Lo que se lleva la máquina:** la web Y el trabajador de ingesta, que era la
otra mitad del plan del 3 de septiembre. `trabajador.cmd` deja de hacer falta:
lo sustituye un servicio de systemd que además arranca solo al reiniciar.

**Lo que hay que saber y no olvidar:**

- **El `.env` del servidor lleva la `service_role` y la `DATABASE_URL`**, así que
  el proceso de la web las tiene en su entorno. En Vercel estaban deliberadamente
  fuera. No llegan al navegador —Next solo empaqueta las `NEXT_PUBLIC_*`— pero
  es una diferencia real. Separarlas exige tocar `next.config.ts`, que carga el
  `.env` de la raíz para el build.
- **Desplegar es `despliegue/desplegar.sh`**, y construye en `.next-build` antes
  de cambiar de sitio. No es manía: construir sobre `.next` le borra el suelo al
  servidor que está sirviendo, que es el tropiezo ya contado en `next.config.ts`.
- **El tiempo de servicio pasa a ser nuestro.** Los parches van solos; lo demás,
  no.

### 2d. Los relacionados tumban la ficha del artista

**Visto en producción el 10 de septiembre, y es un fallo PREVIO** —no de la
caché ni de la mudanza—. En Vercel pasaba igual, y de hecho pasaba más, porque
estas páginas eran dinámicas y la consulta corría en cada visita.

```
⨯ Error: relacionados de vincent-van-gogh: canceling statement due to
  statement timeout
```

La RPC `related_artists` se pasa de los 3 s del `statement_timeout` del rol
`anon`, y como `relatedArtists()` en `lib/data.ts` **lanza una excepción**, se
lleva por delante la ficha entera: 500 en la página del artista.

**Medido, para no volver a medirlo:**

| | ms |
|---|---|
| `honore-daumier` (2.388 obras) | **3.176 — en el filo** |
| `vincent-van-gogh` | 822 |
| `claude-monet`, `rembrandt`, `goya`, `picasso`… | 130–600 |

O sea: **la consulta no está rota, está justa.** Van Gogh en frío tarda 822 ms
y funciona; falló porque en ese momento la base estaba cargada rellenando la
caché de muchas páginas a la vez. El coste no lo manda el número de obras
—Van Gogh no está entre los que más tienen— sino cuántos artistas comparten su
país y su movimiento.

**Son dos arreglos, y el segundo importa más:**

1. **Optimizar la RPC.** Territorio de la migración `0046`, donde están los
   pesos y lo que se midió para elegirlos.
2. **Que una sección secundaria no pueda tumbar la página.** «Por dónde seguir»
   es una puerta de salida: que no se pueda pintar no debe impedir ver al
   pintor. Capturar el error, **registrarlo en voz alta** —nada de cajas
   negras— y pintar la ficha sin esa sección. Diez minutos.

Ojo al hacer el (2): con ISR, una ficha que se pinte sin relacionados **se
queda cacheada así 24 horas**. Por eso el registro tiene que gritar, y por eso
no vale con un `catch` mudo.

### 3. Lo que pidió Manuel el 3 de septiembre y sigue pendiente

De su lista de nueve, siete están hechas y contadas en el historial. Quedan
estas dos, y ninguna se puede empezar a escribir sin decidir algo antes.

- **Compartir un favorito.** Hoy los favoritos son privados por política de
  fila, así que compartir no es «añadir un botón»: es decidir **qué** se
  comparte y **con qué permiso**.

  Lo que hay que responder primero:
  · ¿Una obra suelta, o la lista entera?
  · ¿Una URL con testigo que abra cualquiera sin cuenta, o solo entre usuarios
    registrados?
  · Si es lo primero, ¿se puede revocar? Un enlace que no caduca ni se retira es
    una lista pública que su dueño cree privada.

  Con eso decidido, el trabajo es una columna de testigo, una política de
  lectura y una página. Sin eso decidido, cualquier cosa que escriba será la
  equivocada.

- **Fichas de artista al modo Smartify**: biografía, y más datos de la obra.

  `artists.description` es la frase de una línea de Wikidata —«pintor español
  (1746-1828)»—, no una biografía. Una de verdad sale del extracto de Wikipedia
  (`action=query&prop=extracts&exintro`), que es una fuente que ya usamos de
  hecho para otras cosas y que no cuesta permisos.

  **Lo primero es medir, no traer.** El orden que yo seguiría:
  1. Bajar el extracto de **50 artistas** y medir cuánto ocupa uno de media en
     los tres idiomas. Diez minutos, y decide todo lo demás.
  2. Multiplicar por **11.426**, que son los que tienen obra publicada — no por
     21.619. A los que no se ven no hay que escribirles biografía.
  3. Comparar con los **~93 MB** que quedan y decidir: todos, o solo los que
     pasen de N obras.

  Si sale caro, hay una salida que no ocupa nada: enlazar a Wikipedia en vez de
  copiar el texto. Peor ficha, cero bytes, y encaja con la postura de derechos
  que ya se tomó para las imágenes —miniatura y enlace a la fuente—.

  Lo de «más datos de los cuadros» es otra cosa y más barata: la ficha de obra
  ya trae técnica, género, fecha y dimensiones; lo que falta por decidir es qué
  más de Wikidata merece la pena (inventario, procedencia, exposiciones).

### 4. Decisiones de Manuel, no trabajo

- **¿Puede registrarse cualquiera?** Hoy sí: con un correo válido se crea perfil
  `viewer`, que no da ningún permiso. Si no se quiere, se cierra el registro
  desde Supabase.
- **Las nacionalidades, ya agrupadas** (3 de septiembre). La tabla
  `nationality_country` dice a qué país de hoy pertenece cada etiqueta de
  Wikidata: 200 filas repasadas a mano que cubren el **96% de los artistas**.
  Rembrandt y Van Gogh ya salen los dos en «Países Bajos». El desplegable pasó
  de 220 opciones a 66.

  **Lo que queda sin agrupar son 20 etiquetas, y está decidido así**: cada una
  abarcaba lo que hoy son varios países. La grande es **Habsburg Netherlands
  (264 artistas)** —las diecisiete provincias, hoy NL y BE—, donde caen Brueghel
  y El Bosco. Están en la tabla con `country_code` nulo y su motivo escrito en
  `note`, para que se vea que es una decisión y no un olvido.

  Si se quiere resolver, no es con una regla mejor: es mirando quién es cada
  uno, o guardando el QID de P27 en la ingesta y volviendo a pasar por los
  21.619 artistas.

- **El buscador no filtra por museo concreto**; por ciudad sí.
- **El SMTP de serie de Supabase manda 2-3 correos por hora.** Para usuarios de
  verdad hace falta uno propio (Resend, Postmark); hasta entonces, el segundo
  registro de la hora ve «no hemos podido enviar el correo».
- **Nominatim y las teselas del mapa son terceros sin contrato.**

### 5. La mudanza: Supabase Pro, y el trabajador a un servidor

**Decidido el 3 de septiembre de 2026.** Dos cosas separadas que se decidieron
juntas, y que conviene no volver a mezclar:

1. **Pasar a Supabase Pro.** Levanta el techo de los 500 MB —más allá de los
   8 GB se paga por gigabyte y sale barato— y trae **7 días de copias diarias,
   que en el plan gratuito no hay ninguna**. Deja sin efecto la restricción que
   explicaba dos decisiones del proyecto: **los 4 idiomas retirados (it, de, pt,
   nl) se cayeron porque sus traducciones de catálogo no cabían**, y sus textos
   de interfaz siguen escritos. Reactivarlos pasa a ser una reingesta.

2. **Mudar el trabajador a un VPS de Hetzner.** Hoy la ingesta vive en un `.cmd`
   en el ordenador de Manuel: con la máquina apagada no se puede ingerir desde
   la web, y la migración `0043` existe solo para poder decirlo en pantalla. La
   máquina del trabajador **no guarda estado**: si se muere, los encargos se
   quedan en la cola de `jobs` y no se pierde nada. Un CX22 sobra.

**Por qué NO se autohospeda Supabase**, que fue la idea de partida y se auditó
entera: cabía —solo se usan Postgres con `postgis`/`pg_trgm`/`unaccent`,
PostgREST y GoTrue; ni Storage, ni Realtime, ni Edge Functions, ni `pg_cron`—,
pero ahorrar ~16 €/mes obligaba a adoptar dos averías nuevas (el disco que se
llena, la actualización que rompe un contenedor) y toda una lista de mudanza:
SMTP propio, reconfigurar OAuth de Google y GitHub, rotar `anon` y
`service_role`, volcar `auth.users`. **Separar las dos cosas evita esa lista
entera**: el problema real era el trabajador, no la base.

**Lo que hay que hacer al mudar el trabajador:**

- `trabajador.cmd` → **una unidad de systemd con `Restart=always`**. Hace lo del
  bucle de diez segundos y además sobrevive a los reinicios, que el `.cmd` no.
- `worker.ts` debería portar tal cual: lanza `node` directamente, que era una
  regla motivada por Windows pero que en Linux tampoco estorba.
- El `.env` con la `SERVICE_ROLE_KEY` va en esa máquina. La `DATABASE_URL` de
  las migraciones puede seguir solo en el portátil.
- `workers` se identifica por `host`: el panel enseñará un nombre de máquina
  nuevo y no hay nada que tocar.
- **A partir de ese día el panel es infraestructura, no comodidad.** Cuando la
  ingesta deje de correr en una ventana que se puede mirar, `0026` y `0043` son
  la única forma de saber qué pasa.

**Vercel se queda donde está.** El plan gratuito no aprieta: las imágenes no
pasan por él —`<img>` directo a Commons, Met y AIC—, así que el tráfico es solo
HTML. Las dos cosas a vigilar son la cláusula de uso no comercial del plan
Hobby, y que Googlebot se ponga a rastrear las 232.491 páginas con
`revalidate = 3600`: cada página caducada que pida es una función de Vercel y
una tanda de consultas. La respuesta entonces es subir el `revalidate` de la
cola larga, no cambiar de sitio.

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
