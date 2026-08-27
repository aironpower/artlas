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
  } catch {
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
      return null;
    }

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
  } catch {
    return null;
  }

  const match = candidates.find((c) => isSameWork(work, c));
  if (!match) return null;

  const dims = parseAicDimensions(match.dimensions);

  return {
    medium: match.medium_display,
    heightCm: dims?.heightCm,
    widthCm: dims?.widthCm,
    // IIIF: pedimos 1686px de ancho, el máximo que sirve AIC por defecto.
    imageUrl: match.image_id
      ? `https://www.artic.edu/iiif/2/${match.image_id}/full/1686,/0/default.jpg`
      : undefined,
    iiifBase: match.image_id ? `https://www.artic.edu/iiif/2/${match.image_id}` : undefined,
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
