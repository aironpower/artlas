/**
 * Reglas de auditoría del catálogo.
 *
 * Son funciones PURAS y sin red a propósito. Hoy las usa el auditor sobre lo ya
 * ingerido, pero el objetivo es que la ingesta llame a las mismas antes de
 * escribir, y para eso no pueden depender de que la fila exista en la base ni
 * de que haya internet. La única regla que necesita red vive aparte, en
 * `images.ts`.
 *
 * Cada regla nace de un defecto encontrado de verdad en el catálogo, no de
 * imaginar qué podría salir mal. Si una regla no ha cazado nunca nada, sobra.
 */

import type { Finding, ArtworkRow, ArtistRow, MovementRow } from './types.js';

const COMMONS_FILEPATH = /\/wiki\/Special:FilePath\/(.+)$/;

/** Nombre de fichero de Commons, decodificado. '' si no es de Commons. */
export function commonsFilename(imageUrl: string): string {
  const match = COMMONS_FILEPATH.exec(imageUrl);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/*
 * NO hay regla de "la foto es de la sala, no del cuadro", y no por olvido.
 *
 * Se intentó por el nombre del fichero de Commons y se midió sobre los 6.106
 * nombres del catálogo. Buscar museo/galería/sala marcaba 494 ficheros (8%) que
 * son reproducciones perfectas: Commons nombra los archivos "autor - título -
 * museo", así que el nombre del museo es la procedencia, no la escena. Y al
 * afinarlo a palabras de escena (interior, visitors, vitrine, exhibition view)
 * el resultado fueron 11 aciertos falsos —cuadros TITULADOS "Interior", el de
 * Degas, el de De Hooch— y ni una sola foto de sala.
 *
 * Conclusión medida: el nombre del fichero no contiene esa señal. Detectarlo
 * exige mirar la imagen, no su nombre, y hoy eso es trabajo para un par de ojos
 * sobre una rejilla de miniaturas: la bandeja de revisión del panel de
 * administración. Que nadie vuelva a añadir aquí la heurística del nombre sin
 * volver a medirla.
 */

/** Épocas coladas como movimientos: "17th Century", "nineteenth century". */
const PERIOD = new RegExp(
  '^\\s*(' +
  '\\d{1,2}\\s*(st|nd|rd|th)?|' +
  'fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|' +
  'siglo\\s+[ivxlc]+' +
  ')\\s*(century|siècle|secolo|jahrhundert)?\\s*$',
  'i',
);

const CURRENT_YEAR = new Date().getFullYear();

// ---------------------------------------------------------------------------
// Obras
// ---------------------------------------------------------------------------

export function auditArtwork(work: ArtworkRow): Finding[] {
  const found: Finding[] = [];
  const add = (rule: string, severity: Finding['severity'], detail: string) =>
    found.push({ entityType: 'artwork', entityId: work.id, rule, severity, detail });

  if (!work.image_url) {
    add('image_missing', 'error', 'sin image_url');
  } else {
    const file = commonsFilename(work.image_url);
    const ext = (file || work.image_url).split('.').pop()?.toLowerCase() ?? '';

    /*
     * Un cuadro no se publica en SVG: el SVG es dibujo vectorial, o sea
     * iconos, logotipos y diagramas. Así apareció "Google Maps pin" en el
     * catálogo, con su chincheta por imagen. Es la señal más barata y más
     * fiable de que la fila no es una obra de arte.
     */
    if (ext === 'svg') {
      add('image_is_vector', 'error', `imagen SVG: ${file || work.image_url}`);
    }
  }

  // Sin museo no hay punto en el mapa, que es la razón de ser de la app.
  if (work.institution_id === null) {
    add('institution_missing', 'error', 'obra sin museo: no puede salir en el mapa');
  }

  if (work.artist_id === null) {
    add('artist_missing', 'warning', 'obra sin artista');
  }

  if (work.title.startsWith('http')) {
    add('title_is_url', 'error', `el título es una URL: ${work.title.slice(0, 80)}`);
  }

  if (work.year_start !== null && work.year_start > CURRENT_YEAR) {
    add('year_implausible', 'warning', `año de inicio en el futuro: ${work.year_start}`);
  }

  if (work.year_start !== null && work.year_end !== null && work.year_end < work.year_start) {
    add('year_implausible', 'warning', `rango invertido: ${work.year_start}–${work.year_end}`);
  }

  if (work.year_start === null && !work.date_display) {
    add('date_missing', 'info', 'sin fecha ni texto de fecha');
  }

  return found;
}

// ---------------------------------------------------------------------------
// Artistas
// ---------------------------------------------------------------------------

export function auditArtist(artist: ArtistRow): Finding[] {
  const found: Finding[] = [];
  const add = (rule: string, severity: Finding['severity'], detail: string) =>
    found.push({ entityType: 'artist', entityId: artist.id, rule, severity, detail });

  /*
   * Cuando la autoría de una obra en Wikidata es un nodo anónimo ("atribuido
   * al círculo de…"), la consulta devuelve un identificador `genid` en vez de
   * un nombre, y la ingesta lo guardó tal cual. En la web se lee una URL de 60
   * caracteres donde debería ir el pintor.
   */
  if (artist.name.startsWith('http')) {
    add('name_is_url', 'error', `nombre sin resolver: ${artist.name.slice(0, 80)}`);
  }

  if (!artist.wikidata_qid) {
    add('no_wikidata_qid', 'warning', `artista sin QID: ${artist.name.slice(0, 60)}`);
  }

  return found;
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

/**
 * Raíz de un nombre de movimiento, para detectar los que son el mismo.
 *
 * Quita las coletillas que Wikidata usa indistintamente ("art", "painting",
 * "school", "style") y todo lo que no sea letra. Así `Baroque`,
 * `Baroque painting` y `Baroque art` colapsan en `baroque`.
 */
export function movementRoot(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(art|arts|painting|paintings|movement|school|style)\b/g, '')
    .replace(/[^a-z]/g, '');
}

/**
 * ¿Es este nombre una época y no un movimiento?
 *
 * Se exporta porque lo necesitan los dos lados: el auditor para señalar las
 * que ya están dentro, y la puerta de entrada para no dejar crear más.
 */
export function isPeriodName(name: string): boolean {
  return PERIOD.test(name);
}

/**
 * Los movimientos se auditan en conjunto y no de uno en uno, porque "es un
 * duplicado" solo se puede afirmar mirando a los demás.
 */
export function auditMovements(movements: MovementRow[]): Finding[] {
  const found: Finding[] = [];
  const add = (id: number, rule: string, severity: Finding['severity'], detail: string) =>
    found.push({ entityType: 'movement', entityId: id, rule, severity, detail });

  const families = new Map<string, MovementRow[]>();

  for (const movement of movements) {
    if (PERIOD.test(movement.name)) {
      add(movement.id, 'movement_is_period', 'error',
        `"${movement.name}" es una época, no un movimiento (${movement.artwork_count} obras)`);
      continue;   // ya está señalado; no tiene sentido buscarle duplicados
    }

    /*
     * Los movimientos legítimos vienen de Wikidata con su QID. Los que no lo
     * tienen entraron por el campo de texto libre de la API de algún museo, y
     * son justo los que llegan mal escritos o en minúscula.
     */
    if (!movement.wikidata_qid) {
      add(movement.id, 'movement_no_qid', 'warning',
        `"${movement.name}" sin QID de Wikidata (${movement.artwork_count} obras)`);
    }

    const root = movementRoot(movement.name);
    if (root.length >= 4) {
      families.set(root, [...(families.get(root) ?? []), movement]);
    }
  }

  for (const family of families.values()) {
    if (family.length < 2) continue;

    // El canónico es el que más obras tiene: fusionar hacia él mueve menos.
    const sorted = [...family].sort((a, b) => b.artwork_count - a.artwork_count);
    const [canonical, ...rest] = sorted;
    if (!canonical) continue;

    for (const duplicate of rest) {
      add(duplicate.id, 'movement_duplicate', 'warning',
        `"${duplicate.name}" (${duplicate.artwork_count} obras) parece el mismo que ` +
        `"${canonical.name}" (${canonical.artwork_count} obras)`);
    }
  }

  return found;
}
