/**
 * Enriquecimiento con las APIs propias de los museos.
 *
 * Wikidata da cobertura mundial pero metadatos pobres: la imagen es la que
 * alguien subió a Commons y la técnica suele faltar. Las APIs de los museos
 * dan lo contrario —ficha impecable de su propia colección, cero cobertura
 * fuera de ella— así que se usan como segunda pasada sobre lo ya ingerido.
 *
 * Lo que aportan y Wikidata no:
 *   - IIIF: zoom profundo y recortes a medida sin servir el original.
 *   - Sala concreta ("Gallery 241"): permite guiar dentro del museo.
 *   - Técnica y dimensiones catalogadas por quien tiene la pieza delante.
 *   - AIC además da `style_title`, que es un movimiento pictórico ya limpio.
 *
 * Emparejamiento — la diferencia importa:
 *   Met      devuelve `objectWikidata_URL`, así que el cruce es exacto por QID.
 *   AIC      no tiene QID: hay que buscar por texto y VERIFICAR el autor. Su
 *            búsqueda es difusa y alegre: "Wheat Field with Cypresses" devuelve
 *            como primer resultado un "Wheatfield" de Braque. Aceptar el primer
 *            resultado sin comprobar el autor mete datos cruzados en el catálogo.
 */

import { fetchJson, HttpError, RateLimiter } from '../util/http.js';
import { normalizeArtist, normalizeTitle } from '../normalize.js';
import type { CanonicalArtwork } from '../types.js';

const metLimiter = new RateLimiter(120);
const aicLimiter = new RateLimiter(150);

/** Campos que una API de museo puede mejorar sobre lo que dio Wikidata. */
export interface Enrichment {
  medium?: string;
  heightCm?: number;
  widthCm?: number;
  imageUrl?: string;
  iiifBase?: string;
  imageLicense?: string;
  gallery?: string;
  movementName?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// The Met
// ---------------------------------------------------------------------------

const MET_BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';

interface MetObject {
  objectID: number;
  title: string;
  artistDisplayName: string;
  objectWikidata_URL?: string;
  primaryImage?: string;
  primaryImageSmall?: string;
  medium?: string;
  dimensions?: string;
  GalleryNumber?: string;
  isPublicDomain?: boolean;
  classification?: string;
}

/**
 * Busca una obra en el Met y confirma la identidad por QID.
 *
 * Solo damos por buena la coincidencia si el `objectWikidata_URL` del Met
 * apunta a nuestro QID. Es un cruce exacto: o es la misma obra o no lo es.
 */
export async function enrichFromMet(work: CanonicalArtwork): Promise<Enrichment | null> {
  if (!work.wikidataQid) return null;

  await metLimiter.acquire();

  const query = new URLSearchParams({
    q: work.title,
    hasImages: 'true',
    ...(work.artist ? { artistOrCulture: 'false' } : {}),
  });

  let ids: number[];
  try {
    const search = await fetchJson<{ total: number; objectIDs: number[] | null }>(
      `${MET_BASE}/search?${query}`,
      { label: `met:buscar ${work.title.slice(0, 30)}`, retries: 2 },
    );
    ids = (search.objectIDs ?? []).slice(0, 5);
    anotaExito('met');
  } catch (err) {
    // Se sigue devolviendo null —enriquecer es opcional— pero antes se apunta,
    // porque aquí es donde llega el 403 del muro y tragárselo dejaba al
    // cortacircuitos sin nada que contar.
    anotaPuerta('met', err);
    return null;
  }

  for (const id of ids) {
    await metLimiter.acquire();

    let obj: MetObject;
    try {
      obj = await fetchJson<MetObject>(`${MET_BASE}/objects/${id}`, {
        label: `met:objeto ${id}`,
        retries: 2,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) continue;
      anotaPuerta('met', err);
      return null;
    }

    anotaExito('met');

    const objQid = obj.objectWikidata_URL?.split('/').pop();
    if (objQid !== work.wikidataQid) continue;

    const dims = parseMetDimensions(obj.dimensions);

    return {
      medium: obj.medium,
      heightCm: dims?.heightCm,
      widthCm: dims?.widthCm,
      // La imagen del Met es la de catálogo; supera a la de Commons.
      imageUrl: obj.primaryImage || obj.primaryImageSmall || undefined,
      imageLicense: obj.isPublicDomain ? 'Dominio público (Met · CC0)' : 'Met Museum',
      gallery: obj.GalleryNumber ? `Gallery ${obj.GalleryNumber}` : undefined,
    };
  }

  return null;
}

/**
 * El Met da las medidas en texto libre:
 *   '28 13/16 × 36 3/4 in. (73.2 × 93.4 cm)'
 * Nos quedamos con el paréntesis en cm, que es el formato que usamos.
 */
function parseMetDimensions(raw?: string): { heightCm?: number; widthCm?: number } | null {
  if (!raw) return null;

  const m = /\(([\d.]+)\s*[×x]\s*([\d.]+)\s*cm\)/i.exec(raw);
  if (!m?.[1] || !m[2]) return null;

  const heightCm = Number(m[1]);
  const widthCm = Number(m[2]);

  return Number.isFinite(heightCm) && Number.isFinite(widthCm) ? { heightCm, widthCm } : null;
}

// ---------------------------------------------------------------------------
// Art Institute of Chicago
// ---------------------------------------------------------------------------

const AIC_BASE = 'https://api.artic.edu/api/v1';
const AIC_FIELDS = [
  'id', 'title', 'artist_title', 'date_start', 'date_end',
  'medium_display', 'dimensions', 'image_id', 'style_title',
  'gallery_title', 'classification_title', 'is_public_domain',
].join(',');

interface AicArtwork {
  id: number;
  title: string;
  artist_title?: string;
  date_start?: number;
  medium_display?: string;
  dimensions?: string;
  image_id?: string;
  style_title?: string;
  gallery_title?: string;
  is_public_domain?: boolean;
}

export async function enrichFromAic(work: CanonicalArtwork): Promise<Enrichment | null> {
  await aicLimiter.acquire();

  const query = new URLSearchParams({
    q: work.title,
    limit: '5',
    fields: AIC_FIELDS,
  });

  let candidates: AicArtwork[];
  try {
    const res = await fetchJson<{ data: AicArtwork[]; config: { iiif_url: string } }>(
      `${AIC_BASE}/artworks/search?${query}`,
      { label: `aic:buscar ${work.title.slice(0, 30)}`, retries: 2 },
    );
    candidates = res.data ?? [];
    anotaExito('aic');
  } catch (err) {
    anotaPuerta('aic', err);
    return null;
  }

  const match = candidates.find((c) => isSameWork(work, c));
  if (!match) return null;

  const dims = parseAicDimensions(match.dimensions);

  return {
    medium: match.medium_display,
    heightCm: dims?.heightCm,
    widthCm: dims?.widthCm,
    /*
     * De AIC NO se toma la imagen, y no es por calidad: la suya es mejor que
     * la de Commons. Es que no se puede enseñar.
     *
     * `www.artic.edu` tiene protección antienlace de Cloudflare basada en la
     * cabecera `Referer`. Medido pidiendo la misma URL con cabeceras
     * distintas:
     *
     *     Referer: https://www.artic.edu/   -> 200
     *     Referer: (nuestro dominio)        -> 403
     *     sin Referer                       -> 403
     *
     * O sea que carga desde su propia web y desde ninguna otra. El navegador
     * de nuestro usuario manda nuestro dominio, así que ve un hueco; y
     * `referrerpolicy="no-referrer"` tampoco vale, porque sin Referer también
     * responde 403. Su propia API sigue anunciando esa URL como la buena
     * (`config.iiif_url`), así que esto no se detecta leyendo su
     * documentación: solo pidiéndola.
     *
     * Dejando el campo vacío se conserva la imagen de Wikimedia Commons, que
     * sí se puede enlazar. Fueron 83 obras sin imagen en el catálogo.
     */
    imageUrl: undefined,
    iiifBase: undefined,
    imageLicense: match.is_public_domain ? 'Dominio público (AIC · CC0)' : 'Art Institute of Chicago',
    gallery: match.gallery_title,
    movementName: match.style_title,
  };
}

/**
 * Verifica que el candidato es realmente la misma obra.
 *
 * Exigimos que coincidan autor Y (título o año). Solo con el título, la
 * búsqueda difusa de AIC empareja cuadros distintos del mismo tema; solo con
 * el autor, empareja cualquier obra suya.
 */
function isSameWork(work: CanonicalArtwork, candidate: AicArtwork): boolean {
  if (!work.artist || !candidate.artist_title) return false;

  const sameArtist = normalizeArtist(work.artist.name) === normalizeArtist(candidate.artist_title);
  if (!sameArtist) return false;

  const sameTitle = normalizeTitle(work.title) === normalizeTitle(candidate.title);

  const sameYear =
    work.yearStart !== undefined &&
    candidate.date_start !== undefined &&
    Math.abs(work.yearStart - candidate.date_start) <= 2;

  return sameTitle || sameYear;
}

/** AIC: '73.6 × 92.3 cm (29 × 36 5/8 in.); Framed: ...' */
function parseAicDimensions(raw?: string): { heightCm?: number; widthCm?: number } | null {
  if (!raw) return null;

  const m = /^([\d.]+)\s*[×x]\s*([\d.]+)\s*cm/i.exec(raw.trim());
  if (!m?.[1] || !m[2]) return null;

  const heightCm = Number(m[1]);
  const widthCm = Number(m[2]);

  return Number.isFinite(heightCm) && Number.isFinite(widthCm) ? { heightCm, widthCm } : null;
}

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

/**
 * Aplica el enriquecimiento sin pisar nunca un dato existente con undefined.
 *
 * Todo lo que devuelven AIC y el Met está EN INGLÉS ("Oil on canvas",
 * "Post-Impressionism"), así que se guarda explícitamente bajo `en`. Meterlo
 * en el campo neutro sin marcar el idioma es justo el error que obligó a
 * rehacer el esquema: un texto inglés acabaría mostrándose a un usuario
 * francés como si fuera su idioma.
 */
export function applyEnrichment(work: CanonicalArtwork, extra: Enrichment): CanonicalArtwork {
  return {
    ...work,
    medium: extra.medium ?? work.medium,
    mediums: extra.medium ? { ...work.mediums, en: extra.medium } : work.mediums,
    heightCm: extra.heightCm ?? work.heightCm,
    widthCm: extra.widthCm ?? work.widthCm,
    imageUrl: extra.imageUrl ?? work.imageUrl,
    iiifBase: extra.iiifBase ?? work.iiifBase,
    imageLicense: extra.imageLicense ?? work.imageLicense,
    movements: extra.movementName
      ? [...(work.movements ?? []), {
          name: extra.movementName,
          names: { en: extra.movementName },
        }]
      : work.movements,
  };
}

/**
 * ¿Vale la pena preguntar al museo por esta obra?
 *
 * Enriquecer cuesta unos 8 segundos por obra —búsqueda, ficha y reintentos—
 * frente a los 0,35 s que cuesta traerla de Wikidata: 24 veces más. Preguntar
 * por una obra que ya tiene imagen, técnica y medidas es gastar ese tiempo
 * para no cambiar nada.
 *
 * Medido sobre el catálogo: ya están completas el 23% de las obras del Met, el
 * 36% de las del Art Institute y el 47% de las de Harvard.
 */
export function needsEnrichment(work: CanonicalArtwork): boolean {
  return !work.imageUrl
    || !work.medium
    || work.heightCm === undefined
    || work.widthCm === undefined;
}

/**
 * Cuando un museo nos cierra la puerta.
 *
 * El 28 de agosto de 2026 el Met devolvió 403 con una página de bloqueo
 * antibots tras horas de peticiones. Aun sin reintentar, seguir preguntando
 * son dos viajes HTTP por obra para que te digan que no: el barrido se pasó
 * veinte minutos sin escribir una fila.
 *
 * Así que a la quinta puerta en las narices se deja de preguntar a ESA API
 * durante el resto de la ejecución. No se aborta la ingesta: enriquecer es
 * opcional y las obras se guardan igual con lo de Wikidata. Al relanzar se
 * vuelve a intentar, que es cuando el bloqueo suele haber caducado.
 *
 * Cuentan SEGUIDAS, y cualquier respuesta buena pone el contador a cero. Se
 * midió y hacía falta: el muro del Met es intermitente —deja pasar unas y
 * bloquea otras—, así que contar 403 sueltos habría hecho renunciar a una API
 * que en realidad funcionaba. Cinco seguidas sin un solo acierto en medio ya
 * no es mala suerte.
 */
const PUERTAS_ANTES_DE_RENDIRSE = 5;
const cerrazon = new Map<string, number>();
const rendidos = new Set<string>();

function anotaPuerta(api: string, err: unknown): void {
  if (!(err instanceof HttpError) || (err.status !== 403 && err.status !== 401)) return;

  const van = (cerrazon.get(api) ?? 0) + 1;
  cerrazon.set(api, van);

  if (van >= PUERTAS_ANTES_DE_RENDIRSE && !rendidos.has(api)) {
    rendidos.add(api);
    console.warn(
      `  ⚠ ${api}: nos ha bloqueado (${err.status}). Se sigue SIN enriquecer ` +
      `desde esa API; las obras se guardan igual. Al relanzar se reintenta.`);
  }
}

/** Una respuesta buena: el muro no está, o ha dejado de estar. */
function anotaExito(api: string): void {
  cerrazon.set(api, 0);
}

/** ¿Nos hemos rendido ya con esta API en esta ejecución? */
export function apiBloqueada(api: string): boolean {
  return rendidos.has(api);
}

/**
 * Enriquece un lote entero, con varias peticiones a la vez.
 *
 * En serie el ritmo medido fue de 7,3 obras/min contra las 172 obras/min de la
 * ingesta sin enriquecer. El cuello no es el limitador de ritmo (120 ms), sino
 * que cada obra son dos viajes HTTP —búsqueda y ficha— más sus reintentos, y
 * uno detrás de otro. Las APIs de museo aguantan de sobra unas pocas
 * simultáneas; WDQS no, y por eso allí no se hace lo mismo.
 *
 * Los fallos se ignoran a propósito: enriquecer es opcional y la obra ya tiene
 * los datos de Wikidata, que bastan para su ficha.
 */
export async function enrichBatch(
  works: CanonicalArtwork[],
  api: 'met' | 'aic' | 'harvard',
  concurrency = 6,
): Promise<number> {
  if (apiBloqueada(api)) return 0;

  const pendientes = works.filter(needsEnrichment);
  let enriquecidas = 0;

  for (let i = 0; i < pendientes.length; i += concurrency) {
    if (apiBloqueada(api)) break;

    await Promise.all(pendientes.slice(i, i + concurrency).map(async (work) => {
      try {
        const extra = await enrich(work, api);
        if (!extra) return;

        // Se muta en vez de reemplazar: el índice de deduplicación guarda una
        // referencia a este mismo objeto y perdería los cambios si se sustituye.
        Object.assign(work, applyEnrichment(work, extra));
        enriquecidas++;
      } catch (err) {
        /* enriquecer es opcional; la obra ya tiene lo de Wikidata */
        anotaPuerta(api, err);
      }
    }));
  }

  return enriquecidas;
}

export async function enrich(
  work: CanonicalArtwork,
  api: 'met' | 'aic' | 'harvard',
): Promise<Enrichment | null> {
  switch (api) {
    case 'met': return enrichFromMet(work);
    case 'aic': return enrichFromAic(work);
    // Harvard exige clave de API; se añadirá cuando haya una configurada.
    case 'harvard': return null;
  }
}
