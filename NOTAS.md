# Notas de trabajo

Estado al cerrar la sesión del 27 de agosto de 2026 y lo siguiente a hacer.

---

## Dónde nos quedamos

Funcionando y verificado contra datos reales:

- Esquema en Supabase con las migraciones `0001`, `0002` (multilingüe) y `0003`
  (corrección del bbox del mapa) aplicadas.
- Ingesta multilingüe de 48 museos en 7 idiomas.
- App web en `apps/web`: mapa mundial, buscador con filtros, fichas de obra y
  de museo, "obras cerca de mí". `npm run build && npm start` en esa carpeta.

Catálogo en el último recuento: ~5.000 obras, ~21.000 traducciones,
1.100 artistas, 145 movimientos.

### Comprobar antes de nada al retomar

```bash
cd packages/ingest
npm run check-db        # esquema y credenciales
npm run verify          # ¿siguen respondiendo Wikidata, Met y AIC?
npm run peek            # qué hay en el catálogo
```

La ingesta de los 48 museos estaba en el museo 45 al cerrar. Si no llegó al
final, basta con relanzarla: los checkpoints saltan lo ya hecho.

```bash
npm run start -- --all
```

---

## Lo siguiente: mapa de las obras de un pintor

Pedido explícitamente: poder ver **el mapa de los cuadros de un pintor
concreto**, con **cada obra como una chincheta separada**, no agrupadas en una
bola.

### El problema real, que no es de interfaz

Todas las obras de un museo tienen **exactamente las mismas coordenadas**. No
es un defecto de los datos: `artworks.location` es una copia deliberada del
punto del museo (ver el comentario en `0001_init.sql`), porque el mapa filtra
por bbox y un join a `institutions` por tesela sería el cuello de botella.

Consecuencia: las 30 obras de Picasso en el Reina Sofía son 30 puntos
idénticos. Cualquier mapa por obra los pinta uno encima de otro y se ve una
sola chincheta. Separarlos no se arregla con CSS ni con un clustering
distinto — hay que decidir **qué posición se le da a cada obra**.

Wikidata no tiene coordenadas de sala. Las APIs del Met y de AIC sí dan la sala
(`Gallery 822`, `Gallery 241`) pero solo como texto, sin geometría.

### Opciones a valorar

**A. Abanico al acercar el zoom (spiderfy).** Cuando N obras comparten punto,
se despliegan en círculo o espiral alrededor del museo, con líneas hacia el
centro. Es el patrón conocido de Leaflet.MarkerCluster; en MapLibre hay que
implementarlo a mano. Da lo pedido —cada obra por separado— a cambio de que las
posiciones sean simbólicas, no reales. **Es la que recomendaría**, siendo
explícitos en la interfaz de que el abanico es una forma de mostrar, no una
ubicación.

**B. Desplazamiento determinista.** Mover cada obra unos metros según su id.
Trivial de implementar, pero coloca cuadros en la calle de al lado del museo y
un usuario que mire de cerca verá algo simplemente falso. Descartable.

**C. Dos niveles.** El mapa muestra museos dimensionados por cuántas obras de
ESE pintor tienen, y al pulsar se abre la rejilla de esas obras. Es lo más
honesto con los datos, pero no es lo que se ha pedido.

**D. Coordenadas de sala.** Requiere geometría de interiores que no está en
ninguna de nuestras fuentes. No viable ahora.

### Trabajo que hace falta

1. **Ruta** `/[lang]/artista/[slug]` con mapa + rejilla. Los enlaces de autor
   de las fichas apuntan hoy a `/buscar?artista=…`; pasarían aquí.
2. **RPC nueva**, algo como `artworks_by_artist(p_slug, p_lang)`: la actual
   `search_artworks` filtra por artista pero **no devuelve lat/lng**, así que
   no sirve para pintar un mapa.
3. **Componente de mapa por obra**, con el abanico de la opción A. Conviene que
   sea distinto de `WorldMap` (que agrupa por museo) en vez de llenar ese de
   condicionales.
4. **Encuadre automático** al bbox de las obras del pintor: un pintor con obra
   en Madrid y Nueva York necesita zoom mundial; uno con todo en Florencia, no.

---

## Otras cosas pendientes

- **Valoraciones de usuarios.** Las tablas (`artwork_ratings`,
  `institution_ratings`, `favorites`) están creadas con sus políticas RLS desde
  `0001`, pero no hay ni login ni interfaz. Falta Supabase Auth en la web.
- **Los 2 museos que faltan en la semilla.** Se corrigió el bug de resolución
  de nombres de una sola palabra (Rijksmuseum, Mauritshuis quedaban fuera) pero
  la semilla se generó antes del arreglo. Regenerar con `npm run seed` y volver
  a lanzar la ingesta: los checkpoints saltan los ya hechos.
- **La técnica sale como soporte.** Wikidata usa `P186` (material), que da
  "lienzo" o "tabla" en vez de "óleo sobre lienzo". Solo el Met, AIC y Harvard
  tienen API propia con la técnica bien catalogada; los otros 45 museos se
  quedan con el soporte. Habría que buscar otra propiedad o derivarlo.
- **Chinchetas solapadas en el mapa mundial.** En París el Louvre y Orsay casi
  coinciden al alejar el zoom. Se mitigó dibujando los museos grandes encima,
  pero es el mismo problema de fondo que el mapa por pintor.

---

## Dos tropiezos de método, para no repetirlos

**Borrar `.next` entre builds.** Estuve un buen rato convencido de que el mapa
seguía roto cuando ya estaba arreglado: `next build` reutilizaba las páginas
prerenderizadas y yo miraba datos viejos. Con `rm -rf .next` apareció todo
correcto a la primera.

**No lanzar procesos largos en paralelo sobre el mismo fichero.** Tuve dos
generaciones de `museums.seed.json` corriendo a la vez. Salió bien porque la
correcta terminó la última, pero fue casualidad.
