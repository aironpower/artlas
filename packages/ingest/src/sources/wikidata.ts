/**
 * Conector de Wikidata — la espina dorsal del catálogo.
 *
 * Wikidata es la única fuente que cubre museos de todo el mundo con
 * coordenadas, así que de aquí sale el mapa. Las APIs de los museos
 * (AIC, Met, Harvard) solo enriquecen después con imágenes de más calidad.
 *
 * TRES LECCIONES CARAS — leer antes de tocar las consultas:
 *
 * 1. El endpoint público corta a los 60 s. Cualquier consulta global
 *    ("todas las pinturas con ubicación") revienta. Acotada por museo,
 *    la misma consulta baja de 60 s a ~1 s.
 *
 * 2. Las obras no cuelgan del museo de forma uniforme. Hay dos propiedades
 *    en uso, P195 (colección) y P276 (ubicación), y los museos grandes las
 *    cuelgan de un DEPARTAMENTO, no del museo:
 *
 *      Louvre  P195         ->     4 obras   (inútil)
 *      Louvre  P276         ->    71 obras   (inútil)
 *      Louvre  hijos P361   -> 4.692 obras   <- el Departamento de Pinturas
 *      Prado   P195         -> 3.969
 *      Met     P195         -> 8.787
 *
 *    Por eso expandimos cada museo a su árbol antes de pedir obras. Sin eso
 *    el Louvre aparecería prácticamente vacío en el mapa.
 *
 * 3. Enumerar e hidratar son dos consultas, no una. Meter los OPTIONAL de
 *    autor/fecha/movimiento junto al recorrido de la colección vuelve a
 *    disparar el timeout aunque esté acotado por museo. Primero se piden los
 *    QIDs (barato), después se hidratan en lotes con VALUES (barato). En una
 *    sola consulta: timeout. En dos: 5 s + 1,3 s.
 *
 * 4. Y los TEXTOS son una tercera consulta, aparte de los escalares. Pedir
 *    siete idiomas dentro de la hidratación multiplica las filas por idioma y
 *    por campo traducible antes de agregar (7^5 combinaciones por obra), y
 *    vuelve a dar 504 con solo 12 obras. Ver `fetchTexts`.
 *
 * El patrón se repite en los tres casos: cuando algo va lento, casi siempre la
 * respuesta es partir la consulta, no optimizarla.
 */

import { fetchJson, RateLimiter } from '../util/http.js';
import {
  LANGUAGES, type CanonicalArtwork, type CanonicalInstitution, type Category,
  type CanonicalMovement, type Lang, type Localized, type MuseumSeed,
} from '../types.js';

/** Filtro SPARQL con los idiomas del catálogo: "es","en","fr",... */
const LANG_FILTER = LANGUAGES.map((l) => `"${l}"`).join(',');

/**
 * Wikidata no puede devolver una columna por idioma sin multiplicar filas, así
 * que las etiquetas vienen concatenadas ("es=La Gioconda||en=Mona Lisa") y se
 * desempaquetan aquí.
 *
 * OJO: se usa `rdfs:label` con FILTER por idioma, NO el label service. Son
 * cosas distintas y hace falta cada una en su sitio: el label service da UN
 * texto con respaldo es->en (bien para el valor neutro, mal para saber en qué
 * idioma está), mientras que esto da los idiomas por separado, que es lo que
 * necesitan las tablas de traducción.
 */
function unpackLocalized(raw?: string): Localized {
  const out: Localized = {};
  if (!raw) return out;

  for (const chunk of raw.split('||')) {
    const sep = chunk.indexOf('=');
    if (sep < 1) continue;

    const lang = chunk.slice(0, sep) as Lang;
    const text = chunk.slice(sep + 1).trim();

    // Primera etiqueta gana: Wikidata puede dar varias por idioma.
    if (text && LANGUAGES.includes(lang) && !out[lang]) out[lang] = text;
  }

  return out;
}

/**
 * Bloque SPARQL que concatena las etiquetas de una entidad por idioma.
 *
 * SOLO para consultas de UNA entidad (los metadatos de un museo). Cada bloque
 * multiplica las filas por el número de idiomas antes de agregar, así que con
 * cuatro bloques y un museo son 7^4 filas intermedias: mucho, pero asumible.
 * En un lote de 50 obras la misma técnica da 504 Gateway Timeout — para eso
 * está `fetchTexts`, que no agrega nada. Ver su comentario.
 */
function localizedBlock(entity: string, variable: string, prop = 'rdfs:label'): string {
  return `
      OPTIONAL {
        ${entity} ${prop} ?${variable}_raw .
        FILTER(LANG(?${variable}_raw) IN (${LANG_FILTER}))
        BIND(CONCAT(LANG(?${variable}_raw), "=", ?${variable}_raw) AS ?${variable}_pair)
      }`;
}

const ENDPOINT = 'https://query.wikidata.org/sparql';

// Wikidata pide identificarse; sin User-Agent propio limitan agresivamente.
const USER_AGENT =
  process.env.WIKIDATA_USER_AGENT ?? 'Artlas/0.1 (https://github.com/artlas; contacto@artlas.app)';

// Una consulta cada 1,5 s. WDQS es gratis y compartido: no conviene apretar.
const limiter = new RateLimiter(1500);

/** Cuántos QIDs se hidratan por consulta. Más de ~80 y vuelve a ir lenta. */
const HYDRATE_BATCH = 50;

// --- Clases de obra que nos interesan, y su categoría canónica -------------
const CATEGORY_BY_QID: Record<string, Category> = {
  Q3305213: 'painting',      // pintura
  Q93184: 'drawing',         // dibujo
  Q860861: 'sculpture',      // escultura
  Q11060274: 'print',        // estampa
  Q125191: 'photograph',     // fotografía
  Q17489160: 'decorative',   // obra de artes decorativas
  Q838948: 'other',          // obra de arte (genérico)
};

const WORK_CLASSES = Object.keys(CATEGORY_BY_QID).map((q) => `wd:${q}`).join(' ');

interface SparqlBinding { value: string; type: string; datatype?: string; 'xml:lang'?: string }
interface SparqlResponse { results: { bindings: Record<string, SparqlBinding>[] } }
type Row = Record<string, SparqlBinding>;

/** Ejecuta SPARQL contra WDQS con rate limit y reintentos. */
async function sparql(query: string, label: string): Promise<Row[]> {
  await limiter.acquire();
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetchJson<SparqlResponse>(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    timeoutMs: 75_000,
    label,
  });
  return res.results.bindings;
}

const val = (b: Row, k: string): string | undefined => b[k]?.value;
const qid = (uri?: string): string | undefined => uri?.split('/').pop();

const num = (raw?: string): number | undefined => {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Extrae el año de un literal de fecha de Wikidata.
 * Cuidado: las fechas a.C. vienen como '-0500-01-01T00:00:00Z', con el signo
 * pegado al año, así que no vale con partir por '-'.
 */
function yearOf(raw?: string): number | undefined {
  if (!raw) return undefined;
  const m = /^(-?)(\d{1,4})-/.exec(raw);
  if (!m?.[2]) return undefined;
  const year = Number(m[2]);
  if (!Number.isFinite(year)) return undefined;
  return m[1] === '-' ? -year : year;
}

/** 'Point(2.3354 48.8601)' -> { lat, lng }. Ojo: WKT va lng primero. */
function parsePoint(wkt?: string): { lat: number; lng: number } | undefined {
  if (!wkt) return undefined;
  const m = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(wkt);
  if (!m?.[1] || !m[2]) return undefined;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// 1. Metadatos del museo
// ---------------------------------------------------------------------------

export async function fetchInstitution(museumQid: string): Promise<CanonicalInstitution | null> {
  const query = `
    SELECT ?mLabel ?coord ?cityLabel ?countryLabel ?iso ?website ?image ?visitors
           (GROUP_CONCAT(DISTINCT ?name_pair;    separator="||") AS ?names)
           (GROUP_CONCAT(DISTINCT ?cityName_pair; separator="||") AS ?cities)
           (GROUP_CONCAT(DISTINCT ?ctryName_pair; separator="||") AS ?countries)
           (GROUP_CONCAT(DISTINCT ?desc_pair;    separator="||") AS ?descriptions)
    WHERE {
      BIND(wd:${museumQid} AS ?m)
      OPTIONAL { ?m wdt:P625 ?coord }
      OPTIONAL { ?m wdt:P131 ?city }
      OPTIONAL { ?m wdt:P17 ?country . OPTIONAL { ?country wdt:P297 ?iso } }
      OPTIONAL { ?m wdt:P856 ?website }
      OPTIONAL { ?m wdt:P18 ?image }
      OPTIONAL { ?m wdt:P1174 ?visitors }
      ${localizedBlock('?m', 'name')}
      ${localizedBlock('?city', 'cityName')}
      ${localizedBlock('?country', 'ctryName')}
      ${localizedBlock('?m', 'desc', 'schema:description')}
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
    }
    GROUP BY ?mLabel ?coord ?cityLabel ?countryLabel ?iso ?website ?image ?visitors
    LIMIT 1`;

  const [b] = await sparql(query, `museo ${museumQid}`);
  if (!b) return null;

  const name = val(b, 'mLabel');
  // Si Wikidata no tiene etiqueta, devuelve el propio QID como label.
  if (!name || name === museumQid) return null;

  const point = parsePoint(val(b, 'coord'));

  return {
    wikidataQid: museumQid,
    name,
    kind: 'museum',
    city: val(b, 'cityLabel'),
    country: val(b, 'countryLabel'),
    countryCode: val(b, 'iso'),
    lat: point?.lat,
    lng: point?.lng,
    website: val(b, 'website'),
    imageUrl: val(b, 'image'),
    visitorsYear: num(val(b, 'visitors')),

    names: unpackLocalized(val(b, 'names')),
    cities: unpackLocalized(val(b, 'cities')),
    countries: unpackLocalized(val(b, 'countries')),
    descriptions: unpackLocalized(val(b, 'descriptions')),
  };
}

// ---------------------------------------------------------------------------
// 2. Expansión del museo a sus sub-entidades
// ---------------------------------------------------------------------------

/**
 * Devuelve el museo más todo lo que es "parte de" él (departamentos, alas,
 * salas, colecciones nombradas), dos niveles hacia abajo.
 *
 * Dos niveles y no `P361*` a propósito: el asterisco recursivo dispara el
 * coste y en la práctica ningún museo anida más (museo -> depto -> sala).
 */
export async function expandHolders(museumQid: string): Promise<string[]> {
  const query = `
    SELECT DISTINCT ?sub WHERE {
      { ?sub wdt:P361 wd:${museumQid} }
      UNION
      { ?sub wdt:P361/wdt:P361 wd:${museumQid} }
    } LIMIT 400`;

  const rows = await sparql(query, `sub-entidades ${museumQid}`);
  const subs = rows.map((r) => qid(val(r, 'sub'))).filter((q): q is string => Boolean(q));

  return [museumQid, ...subs];
}

// ---------------------------------------------------------------------------
// 3. FASE A — enumerar los QIDs de las obras del museo
// ---------------------------------------------------------------------------

/**
 * El filtro de notoriedad va AQUÍ, no en la hidratación, y esa decisión es la
 * que hace viable el catálogo curado.
 *
 * El Louvre tiene 4.692 obras, pero solo 149 con >= 8 sitelinks. Filtrando en
 * la enumeración hidratamos 149 (3 lotes); filtrando después habría que
 * hidratar las 4.692 (94 lotes) para tirar el 97%. Y no sale caro: la propia
 * consulta con FILTER + ORDER BY DESC(sitelinks) tarda 1,6 s.
 *
 * Ordenar por notoriedad descendente además hace que, si se corta por `limit`,
 * lo que entra sea lo más conocido y no lo alfabéticamente primero.
 */
async function* listWorkQids(
  holders: string[],
  pageSize: number,
  hardLimit: number,
  minNotability: number,
): AsyncGenerator<string[]> {
  const holderValues = holders.map((h) => `wd:${h}`).join(' ');
  let offset = 0;
  let total = 0;

  const curated = minNotability > 0;

  // Con notoriedad: fama primero, ?work para desempatar (si no, el OFFSET
  // podría repetir o saltarse obras entre páginas al empatar sitelinks).
  const notabilityClause = curated
    ? `?work wikibase:sitelinks ?sitelinks . FILTER(?sitelinks >= ${minNotability})`
    : '';
  const ordering = curated ? 'ORDER BY DESC(?sitelinks) ?work' : 'ORDER BY ?work';

  while (total < hardLimit) {
    const query = `
      SELECT DISTINCT ?work ${curated ? '?sitelinks' : ''} WHERE {
        VALUES ?holder { ${holderValues} }
        { ?work wdt:P195 ?holder } UNION { ?work wdt:P276 ?holder }
        VALUES ?class { ${WORK_CLASSES} }
        ?work wdt:P31 ?class .
        ${notabilityClause}
      }
      ${ordering}
      LIMIT ${pageSize} OFFSET ${offset}`;

    const rows = await sparql(query, `enumerar +${offset}`);
    const qids = rows.map((r) => qid(val(r, 'work'))).filter((q): q is string => Boolean(q));

    if (qids.length === 0) return;

    yield qids;
    total += qids.length;

    // Menos filas que el tamaño de página => era la última.
    if (rows.length < pageSize) return;
    offset += pageSize;
  }
}

// ---------------------------------------------------------------------------
// 4. FASE B — hidratar un lote de QIDs con todos sus metadatos
// ---------------------------------------------------------------------------

/**
 * Nota sobre etiquetas: usamos SIEMPRE el `wikibase:label` service, que aplica
 * fallback es -> en. La alternativa aparentemente equivalente,
 * `?x rdfs:label ?l FILTER(lang(?l) = "es")`, descarta en silencio las obras
 * que solo tienen etiqueta inglesa: en pruebas dejó la Gioconda sin autor y
 * el Giotto sin título. `?titleEsOnly` se pide aparte, precisamente porque ahí
 * sí queremos saber si existe traducción al español.
 */
/**
 * FASE B1 — datos escalares de un lote de obras (sin nada de idiomas).
 *
 * De los movimientos solo se piden los QID, no las etiquetas: un QID por
 * movimiento no multiplica filas, mientras que sus etiquetas sí.
 */
async function hydrateScalars(qids: string[]): Promise<Row[]> {
  const values = qids.map((q) => `wd:${q}`).join(' ');

  return sparql(`
    SELECT ?work ?workLabel ?class ?sitelinks ?image
           ?creator ?creatorLabel ?birth ?death ?nationalityLabel
           ?inception ?earliest ?latest ?height ?width
           ?material ?materialLabel ?genre ?genreLabel
           (GROUP_CONCAT(DISTINCT ?movementQid; separator="|") AS ?movements)
    WHERE {
      VALUES ?work { ${values} }
      ?work wdt:P31 ?class .
      VALUES ?class { ${WORK_CLASSES} }

      OPTIONAL { ?work wdt:P18 ?image }
      OPTIONAL { ?work wikibase:sitelinks ?sitelinks }

      OPTIONAL {
        ?work wdt:P170 ?creator .
        OPTIONAL { ?creator wdt:P569 ?birth }
        OPTIONAL { ?creator wdt:P570 ?death }
        OPTIONAL { ?creator wdt:P27 ?nationality }
      }

      OPTIONAL { ?work wdt:P571 ?inception }
      OPTIONAL { ?work wdt:P1319 ?earliest }
      OPTIONAL { ?work wdt:P1326 ?latest }
      OPTIONAL { ?work wdt:P2048 ?height }
      OPTIONAL { ?work wdt:P2049 ?width }
      OPTIONAL { ?work wdt:P186 ?material }
      OPTIONAL { ?work wdt:P136 ?genre }

      OPTIONAL {
        ?work wdt:P135 ?movement .
        BIND(STRAFTER(STR(?movement), "entity/") AS ?movementQid)
      }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
    }
    GROUP BY ?work ?workLabel ?class ?sitelinks ?image
             ?creator ?creatorLabel ?birth ?death ?nationalityLabel
             ?inception ?earliest ?latest ?height ?width
             ?material ?materialLabel ?genre ?genreLabel`,
    `escalares ${qids.length}`);
}

/** Etiquetas y descripciones de una entidad, por idioma. */
interface EntityText { labels: Localized; descriptions: Localized }

/**
 * FASE B2 — todas las etiquetas de golpe, en una consulta PLANA.
 *
 * Aquí está la lección más cara del conector, y es una versión más fina de la
 * nº3: no basta con separar enumerar de hidratar, hay que separar TAMBIÉN los
 * textos de los escalares.
 *
 * El intento anterior pedía los siete idiomas dentro de la consulta de
 * hidratación, con un OPTIONAL + GROUP_CONCAT por cada campo traducible
 * (título, autor, descripción, material, género). Cada OPTIONAL multiplica las
 * filas por el número de idiomas ANTES de agregar: 7 idiomas x 5 campos son
 * hasta 7^5 combinaciones por obra. Resultado, 504 Gateway Timeout con solo
 * 12 obras.
 *
 * Esta consulta no agrega nada: devuelve una fila por (entidad, idioma) y el
 * emparejamiento se hace en JavaScript, que para esto es gratis. Medido:
 * 150 entidades x 7 idiomas, etiquetas y descripciones, 1.890 filas en 1,06 s.
 */
async function fetchTexts(entityQids: string[]): Promise<Map<string, EntityText>> {
  const result = new Map<string, EntityText>();
  if (entityQids.length === 0) return result;

  const values = entityQids.map((q) => `wd:${q}`).join(' ');

  const rows = await sparql(`
    SELECT ?e ?kind ?text WHERE {
      VALUES ?e { ${values} }
      { ?e rdfs:label ?text . BIND("l" AS ?kind) }
      UNION
      { ?e schema:description ?text . BIND("d" AS ?kind) }
      FILTER(LANG(?text) IN (${LANG_FILTER}))
    }`,
    `textos ${entityQids.length}`);

  for (const row of rows) {
    const entity = qid(val(row, 'e'));
    // El idioma viaja en el propio literal, no en una columna aparte.
    const lang = row['text']?.['xml:lang'] as Lang | undefined;
    const text = val(row, 'text');
    if (!entity || !lang || !text) continue;

    const entry = result.get(entity) ?? { labels: {}, descriptions: {} };
    const target = val(row, 'kind') === 'd' ? entry.descriptions : entry.labels;

    if (!target[lang]) target[lang] = text;
    result.set(entity, entry);
  }

  return result;
}

// ---------------------------------------------------------------------------
// 5. Orquestación
// ---------------------------------------------------------------------------

export interface FetchWorksOptions {
  /** Solo obras con imagen. El catálogo curado no quiere fichas vacías. */
  requireImage?: boolean;
  /** Mínimo de sitelinks. 0 = todo; 5-10 filtra a obras realmente conocidas. */
  minNotability?: number;
  /** Tamaño de página de la fase de enumeración. */
  pageSize?: number;
  /** Tope de obras por museo. */
  limit?: number;
}

export async function* fetchArtworks(
  museum: MuseumSeed,
  institution: CanonicalInstitution,
  opts: FetchWorksOptions = {},
): AsyncGenerator<CanonicalArtwork> {
  const {
    requireImage = true,
    minNotability = 0,
    pageSize = 500,
    limit = 20_000,
  } = opts;

  const holders = await expandHolders(museum.qid);
  const emitted = new Set<string>();
  let yielded = 0;

  for await (const page of listWorkQids(holders, pageSize, limit, minNotability)) {
    for (let i = 0; i < page.length; i += HYDRATE_BATCH) {
      const batch = page.slice(i, i + HYDRATE_BATCH);
      const rows = await hydrateScalars(batch);

      // Reunimos TODAS las entidades cuyo texto hace falta —obras, autores,
      // materiales, géneros y movimientos— y pedimos sus etiquetas de una vez.
      // Una sola consulta plana por lote, en vez de multiplicar la de arriba.
      const needText = new Set<string>();
      for (const row of rows) {
        for (const key of ['work', 'creator', 'material', 'genre'] as const) {
          const id = qid(val(row, key));
          if (id) needText.add(id);
        }
        for (const m of (val(row, 'movements') ?? '').split('|')) {
          if (m) needText.add(m);
        }
      }

      const texts = await fetchTexts([...needText]);

      for (const row of rows) {
        const workQid = qid(val(row, 'work'));
        if (!workQid || emitted.has(workQid)) continue;

        const artwork = toCanonical(row, workQid, institution, texts);
        if (!artwork) continue;
        if (requireImage && !artwork.imageUrl) continue;
        if ((artwork.notability ?? 0) < minNotability) continue;

        emitted.add(workQid);
        yield artwork;
        if (++yielded >= limit) return;
      }
    }
  }
}

function toCanonical(
  row: Row,
  workQid: string,
  institution: CanonicalInstitution,
  texts: Map<string, EntityText>,
): CanonicalArtwork | null {
  const title = val(row, 'workLabel');
  // Sin etiqueta, Wikidata devuelve el QID: eso no es un título.
  if (!title || title === workQid) return null;

  const classQid = qid(val(row, 'class'));
  const category: Category = (classQid ? CATEGORY_BY_QID[classQid] : undefined) ?? 'other';

  // La fecha puede venir exacta (P571) o como rango (P1319 / P1326).
  const inception = yearOf(val(row, 'inception'));
  const earliest = yearOf(val(row, 'earliest'));
  const latest = yearOf(val(row, 'latest'));
  const yearStart = inception ?? earliest;
  const yearEnd = inception ?? latest ?? earliest;

  const creatorName = val(row, 'creatorLabel');
  const creatorQid = qid(val(row, 'creator'));

  const textsOf = (id?: string): EntityText =>
    (id && texts.get(id)) || { labels: {}, descriptions: {} };

  const workTexts = textsOf(workQid);
  const creatorTexts = textsOf(creatorQid);

  return {
    wikidataQid: workQid,
    title,
    titles: workTexts.labels,
    descriptions: workTexts.descriptions,
    mediums: textsOf(qid(val(row, 'material'))).labels,
    genres: textsOf(qid(val(row, 'genre'))).labels,

    artist: creatorName && creatorName !== creatorQid
      ? {
          wikidataQid: creatorQid,
          name: creatorName,
          names: creatorTexts.labels,
          descriptions: creatorTexts.descriptions,
          birthYear: yearOf(val(row, 'birth')),
          deathYear: yearOf(val(row, 'death')),
          nationality: val(row, 'nationalityLabel'),
        }
      : undefined,

    institution,
    movements: buildMovements(val(row, 'movements'), texts),

    yearStart,
    yearEnd,
    dateDisplay: formatDate(yearStart, yearEnd),

    category,
    medium: val(row, 'materialLabel'),
    genre: val(row, 'genreLabel'),
    heightCm: sanitizeDimension(num(val(row, 'height'))),
    widthCm: sanitizeDimension(num(val(row, 'width'))),

    imageUrl: val(row, 'image'),
    imageLicense: 'Wikimedia Commons',

    source: 'wikidata',
    sourceId: workQid,
    sourceUrl: `https://www.wikidata.org/wiki/${workQid}`,

    notability: num(val(row, 'sitelinks')) ?? 0,
    description: val(row, 'workDescription'),
  };
}

/**
 * Construye los movimientos a partir de sus QID y del mapa de textos.
 * Un movimiento sin etiqueta en ninguno de nuestros idiomas se descarta: sin
 * nombre no se puede ni mostrar ni filtrar por él.
 */
function buildMovements(raw: string | undefined, texts: Map<string, EntityText>): CanonicalMovement[] {
  const movements: CanonicalMovement[] = [];

  for (const movementQid of (raw ?? '').split('|')) {
    if (!movementQid) continue;

    const names = texts.get(movementQid)?.labels ?? {};
    const fallback = names.en ?? Object.values(names)[0];
    if (!fallback) continue;

    movements.push({ wikidataQid: movementQid, name: fallback, names });
  }

  return movements;
}

/**
 * Wikidata guarda las dimensiones con unidad, pero `wdt:` la pierde y devuelve
 * el número pelado. En obras de arte la unidad dominante es el centímetro, así
 * que asumimos cm y descartamos lo que caiga fuera de un rango plausible
 * (1 cm a 50 m) en vez de guardar un dato que sabemos mal medido.
 */
function sanitizeDimension(value?: number): number | undefined {
  if (value === undefined) return undefined;
  return value >= 1 && value <= 5000 ? value : undefined;
}

function formatDate(start?: number, end?: number): string | undefined {
  if (start === undefined) return undefined;
  const fmt = (y: number) => (y < 0 ? `${-y} a.C.` : String(y));
  if (end === undefined || end === start) return fmt(start);
  return `${fmt(start)}–${fmt(end)}`;
}
