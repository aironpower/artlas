/**
 * Normalización y deduplicación.
 *
 * El mismo cuadro llega por dos caminos —Wikidata lo tiene como Q160236 y la
 * API del Met como objeto 436535— y hay que reconocerlo como uno solo. La
 * clave estable es el QID de Wikidata; cuando no hay QID, caemos a una huella
 * derivada de (título + autor + año).
 */

import type { CanonicalArtwork, Category } from './types.js';

/** "Les Demoiselles d'Avignon" -> "les-demoiselles-d-avignon" */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')     // quita diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sin-titulo';
}

/**
 * Forma comparable de un título: sin acentos, sin puntuación, sin artículos
 * iniciales ni el "(detalle)" / "[copia]" que añaden algunos museos.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/^(the|a|an|el|la|los|las|un|una|le|les|il|der|die|das)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forma comparable de un nombre de artista. Aplana "Picasso, Pablo" y
 * "Pablo Picasso" a la misma cadena para que el emparejamiento funcione
 * entre fuentes que usan convenciones distintas.
 */
export function normalizeArtist(name: string): string {
  const flat = name.includes(',')
    ? name.split(',').map((p) => p.trim()).reverse().join(' ')
    : name;

  return flat
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(sir|saint|st|van|de|der|del|di|da|le|la)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Huella para detectar la misma obra entre fuentes distintas.
 *
 * El año se redondea a década: las fuentes discrepan constantemente en la
 * datación exacta ("1503" vs "c. 1506") pero rara vez por más de una década,
 * y exigir el año exacto rompería casi todos los emparejamientos reales.
 */
export function fingerprint(work: CanonicalArtwork): string {
  const title = normalizeTitle(work.title);
  const artist = work.artist ? normalizeArtist(work.artist.name) : 'anonimo';
  const decade = work.yearStart !== undefined ? Math.floor(work.yearStart / 10) * 10 : 'sf';
  return `${title}::${artist}::${decade}`;
}

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

const CATEGORY_HINTS: [RegExp, Category][] = [
  [/\b(paint|oil|canvas|tempera|fresco|acrylic|óleo|lienzo|pintura)\b/i, 'painting'],
  [/\b(sculpt|bronze|marble|escultura|mármol)\b/i, 'sculpture'],
  [/\b(drawing|charcoal|pencil|chalk|dibujo|carboncillo)\b/i, 'drawing'],
  [/\b(print|etching|engraving|lithograph|woodcut|grabado|litografía)\b/i, 'print'],
  [/\b(photograph|gelatin silver|daguerreotype|fotografía)\b/i, 'photograph'],
  [/\b(ceramic|porcelain|furniture|textile|silver|cerámica|porcelana)\b/i, 'decorative'],
];

/** Deduce la categoría de un texto libre de técnica/clasificación. */
export function inferCategory(text?: string, fallback: Category = 'other'): Category {
  if (!text) return fallback;
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(text)) return category;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Fechas en texto libre (las APIs de museos no dan años estructurados)
// ---------------------------------------------------------------------------

/**
 * Interpreta las fechas que escriben los museos:
 *   "1503-1519"  "c. 1660"  "ca. 1890s"  "1907"  "17th century"  "n.d."
 */
export function parseDateRange(raw?: string): { start?: number; end?: number } {
  if (!raw) return {};
  const text = raw.trim().toLowerCase();

  // "17th century" / "siglo XVII"
  const century = /(\d{1,2})(st|nd|rd|th)\s+century/.exec(text);
  if (century?.[1]) {
    const c = Number(century[1]);
    return { start: (c - 1) * 100, end: c * 100 - 1 };
  }

  const years = [...text.matchAll(/\b(\d{3,4})\b/g)]
    .map((m) => Number(m[1]))
    .filter((y) => y >= 100 && y <= new Date().getFullYear());

  if (years.length === 0) return {};

  const start = Math.min(...years);
  const end = Math.max(...years);

  // "1890s" abarca la década entera.
  if (/\d0s\b/.test(text) && years.length === 1) {
    return { start, end: start + 9 };
  }

  return { start, end };
}

// ---------------------------------------------------------------------------
// Fusión de registros duplicados
// ---------------------------------------------------------------------------

/**
 * Prioridad de fuente para resolver conflictos campo a campo.
 * Las APIs de los museos ganan a Wikidata en los datos del objeto (técnica,
 * dimensiones, imagen en alta) porque catalogan la pieza que tienen delante;
 * Wikidata gana en lo contextual (movimiento, notoriedad, geografía).
 */
const SOURCE_RANK: Record<string, number> = {
  manual: 100, aic: 60, met: 55, harvard: 50, europeana: 30, wikidata: 20,
};

/**
 * Funde dos registros de la misma obra. `base` es el existente y `incoming`
 * el recién llegado; cada campo lo gana la fuente de mayor rango que lo tenga
 * relleno, de modo que un dato ausente nunca pisa a uno presente.
 */
export function mergeArtworks(base: CanonicalArtwork, incoming: CanonicalArtwork): CanonicalArtwork {
  const incomingWins = (SOURCE_RANK[incoming.source] ?? 0) >= (SOURCE_RANK[base.source] ?? 0);
  const [high, low] = incomingWins ? [incoming, base] : [base, incoming];

  const pick = <K extends keyof CanonicalArtwork>(key: K): CanonicalArtwork[K] =>
    high[key] ?? low[key];

  return {
    ...low,
    ...Object.fromEntries(
      Object.entries(high).filter(([, v]) => v !== undefined && v !== null),
    ),

    // El QID nunca se pierde: es la clave de identidad entre fuentes.
    wikidataQid: base.wikidataQid ?? incoming.wikidataQid,

    // La notoriedad solo la sabe Wikidata; nos quedamos con el máximo visto.
    notability: Math.max(base.notability ?? 0, incoming.notability ?? 0),

    // Unión de movimientos: cada fuente aporta los suyos.
    movements: dedupeMovements([...(base.movements ?? []), ...(incoming.movements ?? [])]),

    // La imagen en alta resolución es lo más valioso de las APIs de museo.
    iiifBase: pick('iiifBase'),
    imageUrl: pick('imageUrl'),

    // Y la geolocalización viene siempre del museo ya resuelto.
    institution: base.institution ?? incoming.institution,
  } as CanonicalArtwork;
}

function dedupeMovements(list: NonNullable<CanonicalArtwork['movements']>) {
  const byKey = new Map<string, (typeof list)[number]>();
  for (const m of list) {
    const key = m.wikidataQid ?? normalizeTitle(m.name);
    if (!byKey.has(key)) byKey.set(key, m);
  }
  return [...byKey.values()];
}

/**
 * Índice en memoria para reconocer obras ya vistas durante una ejecución.
 * Consulta primero por QID (exacto) y después por huella (heurístico).
 */
export class DedupeIndex {
  private byQid = new Map<string, CanonicalArtwork>();
  private byFingerprint = new Map<string, CanonicalArtwork>();

  find(work: CanonicalArtwork): CanonicalArtwork | undefined {
    if (work.wikidataQid) {
      const hit = this.byQid.get(work.wikidataQid);
      if (hit) return hit;
    }

    const hit = this.byFingerprint.get(fingerprint(work));

    /*
     * Dos ítems de Wikidata con QID distinto son obras DISTINTAS, por mucho que
     * compartan título, autor y década. La huella existe para emparejar la
     * misma obra entre fuentes distintas —Wikidata con el Met, con AIC—, no
     * para decidir que dos entradas del propio Wikidata son la misma.
     *
     * Sin esta comprobación, los paneles de un mismo retablo se fusionaban en
     * una sola fila: en Wikidata es normal que compartan etiqueta exacta
     * ("Episodes from the Lives of Mary Magdalen"), autor y década. El barrido
     * completo dejó 1.567 filas con el `source_id` de una obra y el
     * `wikidata_qid` de otra, y la siguiente ingesta reventaba al chocar contra
     * `artworks_wikidata_qid_key`. Con el catálogo curado apenas se notaba;
     * con 113.000 obras se hizo evidente.
     */
    if (hit?.wikidataQid && work.wikidataQid && hit.wikidataQid !== work.wikidataQid) {
      return undefined;
    }

    return hit;
  }

  add(work: CanonicalArtwork): void {
    if (work.wikidataQid) this.byQid.set(work.wikidataQid, work);
    this.byFingerprint.set(fingerprint(work), work);
  }

  get size(): number {
    return this.byFingerprint.size;
  }
}
