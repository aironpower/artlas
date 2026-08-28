/**
 * Nationalmuseum de Estocolmo — api.nationalmuseum.se
 *
 * Es el museo con más obras esperando imagen del catálogo: 23.214 de las
 * 61.108 totales, un tercio de toda la sala de espera.
 *
 * Lo que se midió antes de escribir esto, muestreando 2.000 objetos repartidos
 * por sus 208.334:
 *
 *   · el 51,5% tiene imagen IIIF          (~107.000 objetos)
 *   · el 95% tiene número de inventario
 *   · el 51,4% tiene AMBOS
 *
 * Y dos cosas que condicionan el diseño:
 *
 * 1. **No admite búsqueda.** `search`, `q`, `query`, `title`, `artist` — todos
 *    los parámetros se ignoran y devuelven el catálogo entero. Así que no se
 *    puede preguntar por una obra: hay que descargarse las 2.084 páginas una
 *    vez y cruzar en local.
 *
 * 2. **Sus títulos están en sueco** ("Landskap med pinjer") y los nuestros
 *    vienen de Wikidata en inglés. Cruzar por título fallaría en la mayoría.
 *    Por eso la clave es el NÚMERO DE INVENTARIO, que ellos publican y que
 *    Wikidata guarda en P217 ("NMB 1723", "NMH 1143/1924"). Mismo formato en
 *    los dos lados: prefijo, espacio, número.
 *
 * Las imágenes se sirven por IIIF desde iiifhosting.com y —comprobado— se
 * pueden enlazar desde cualquier dominio, sin el bloqueo por Referer que tiene
 * el Art Institute.
 */

const API = 'https://api.nationalmuseum.se/api/objects';
const PAGE_SIZE = 100;
const PAUSE_MS = 400;

/** QID del museo en la semilla, para no repetirlo por ahí suelto. */
export const NATIONALMUSEUM_QID = 'Q842858';

export interface MuseumObject {
  /** Número de inventario normalizado, que es la clave de cruce. */
  inventoryKey: string;
  /** Tal y como ellos lo escriben, para poder mostrarlo y depurar. */
  inventoryNumber: string;
  /** Base IIIF; la URL de imagen se construye a partir de ella. */
  iiifBase: string;
  title: string;
  artist?: string;
  license?: string;
  credit?: string;
}

/**
 * Normaliza un número de inventario para poder compararlo.
 *
 * "NMB 1723" y "nmb1723" son el mismo objeto; "NMH 1143/1924" conserva la
 * barra porque distingue la obra dentro de un ingreso. Se quitan espacios y se
 * pasa a mayúsculas, nada más: recortar más agruparía objetos distintos.
 */
export function inventoryKey(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** URL de imagen a partir de la base IIIF. Comprobada contra su servidor. */
export function iiifImage(base: string, width: 250 | 500 | 1280 = 500): string {
  // Sirven por http; se fuerza https para no romper la página con contenido mixto.
  return `${base.replace(/^http:/, 'https:')}/full/${width},/0/default.jpg`;
}

/**
 * Descarga el catálogo entero, quedándose solo con lo que sirve: objetos que
 * tienen a la vez imagen y número de inventario.
 *
 * `onProgress` existe porque son 2.084 peticiones y sin señales parece colgado.
 */
export async function* fetchCatalogue(
  userAgent: string,
  onProgress?: (page: number, totalPages: number, kept: number) => void,
): AsyncGenerator<MuseumObject> {
  let page = 1;
  let totalPages = 1;
  let kept = 0;

  while (page <= totalPages) {
    const res = await fetch(`${API}?limit=${PAGE_SIZE}&page=${page}`, {
      headers: { 'User-Agent': userAgent },
    });

    if (!res.ok) {
      // Una página caída no invalida el resto: se salta y se sigue.
      page++;
      continue;
    }

    const json = await res.json() as {
      data?: { paging?: { total_pages?: number }; items?: Record<string, any>[] };
    };

    totalPages = json.data?.paging?.total_pages ?? totalPages;

    for (const item of json.data?.items ?? []) {
      const inv = item.inventory_number;
      const iiif = item.iiif;
      if (!inv || !iiif) continue;

      const title = item.title?.en || item.title?.sv || '';
      if (!title) continue;

      kept++;
      yield {
        inventoryKey: inventoryKey(String(inv)),
        inventoryNumber: String(inv),
        iiifBase: String(iiif),
        title,
        artist: item.actors?.[0]?.actor_full_name ?? undefined,
        license: item.iiif_license?.license ?? undefined,
        credit: item.iiif_license?.creditline ?? undefined,
      };
    }

    onProgress?.(page, totalPages, kept);
    page++;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}
