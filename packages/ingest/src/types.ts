/**
 * Modelo canónico de Artlas.
 *
 * Cada conector (Wikidata, AIC, Met, Harvard) traduce su formato a estos tipos.
 * A partir de aquí el pipeline no sabe de qué museo vino el dato.
 */

export type Source = 'wikidata' | 'aic' | 'met' | 'harvard' | 'europeana' | 'manual';

/**
 * Idiomas del catálogo. Deben coincidir con la tabla `languages` de la base
 * de datos, que es la que mapea cada código a su diccionario de Postgres.
 */
/*
 * Tres idiomas, no siete, y es una decisión de espacio, no de producto.
 *
 * Cada obra genera una fila de traducción por idioma, con su vector de
 * búsqueda. Amasar 182.000 obras por siete idiomas son 1,3 millones de filas y
 * no caben en los 500 MB del plan gratuito de Supabase. Con tres caben.
 *
 * Los textos de interfaz de los otros cuatro siguen escritos en la web: volver
 * a activarlos es añadirlos aquí y reingerir, no traducir de nuevo.
 */
export const LANGUAGES = ['es', 'en', 'fr'] as const;
export type Lang = (typeof LANGUAGES)[number];

/**
 * Texto en varios idiomas: { es: 'La Gioconda', en: 'Mona Lisa', ... }
 * Siempre parcial: casi ninguna obra tiene etiqueta en los siete.
 */
export type Localized = Partial<Record<Lang, string>>;

export type Category =
  | 'painting' | 'sculpture' | 'drawing' | 'print'
  | 'photograph' | 'installation' | 'decorative' | 'other';

export interface CanonicalArtist {
  wikidataQid?: string;
  /** Respaldo neutro (inglés si existe). Lo mostrable sale de `names`. */
  name: string;
  names?: Localized;
  descriptions?: Localized;
  sortName?: string;
  birthYear?: number;
  deathYear?: number;
  nationality?: string;
  imageUrl?: string;
}

export interface CanonicalMovement {
  wikidataQid?: string;
  name: string;
  names?: Localized;
  startYear?: number;
  endYear?: number;
}

export interface CanonicalInstitution {
  wikidataQid?: string;
  name: string;
  kind?: 'museum' | 'gallery' | 'church' | 'palace' | 'public_space' | 'private' | 'other';
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  website?: string;
  imageUrl?: string;
  visitorsYear?: number;

  names?: Localized;
  cities?: Localized;
  countries?: Localized;
  descriptions?: Localized;
}

export interface CanonicalArtwork {
  wikidataQid?: string;
  /** Respaldo neutro (inglés si existe). Lo mostrable sale de `titles`. */
  title: string;
  titles?: Localized;
  descriptions?: Localized;
  /** Técnica y género traducidos: 'Óleo sobre lienzo' / 'Oil on canvas'. */
  mediums?: Localized;
  genres?: Localized;

  artist?: CanonicalArtist;
  institution?: CanonicalInstitution;
  movements?: CanonicalMovement[];

  yearStart?: number;
  yearEnd?: number;
  dateDisplay?: string;

  category: Category;
  medium?: string;
  genre?: string;
  heightCm?: number;
  widthCm?: number;

  imageUrl?: string;
  iiifBase?: string;
  imageLicense?: string;

  /*
   * Lo que la FUENTE declara sobre los derechos (Wikidata P6216), no lo que
   * nosotros deduzcamos. `undefined` significa que no lo dice, y entonces sí
   * hay que deducirlo de la fecha de muerte del autor.
   */
  copyrightStatus?: 'public_domain' | 'in_copyright';

  /**
   * Número de inventario del museo (Wikidata P217): "NMB 1723".
   * Es la clave con la que se cruza la obra con la API de su museo.
   */
  inventoryNumber?: string;

  source: Source;
  sourceId: string;
  sourceUrl?: string;

  /** Nº de Wikipedias que enlazan la obra. Proxy de importancia. */
  notability?: number;
  description?: string;
}

/** Museo de partida del pipeline: de aquí salen las consultas acotadas. */
export interface MuseumSeed {
  qid: string;
  name: string;
  /** Conector de enriquecimiento con API propia, si lo tiene. */
  api?: 'aic' | 'met' | 'harvard';
}

export interface IngestStats {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  /** Guardadas y visibles en la app. */
  published: number;
  /** Guardadas, esperando el dato que les falta. */
  pending: number;
  /** Guardadas como "no es una obra de arte". */
  rejected: number;
  /** Obras que entraron con algún dato corregido. */
  repaired: number;
}
