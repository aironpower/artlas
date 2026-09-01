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
 * Vuelto a medir el 31 de agosto de 2026 sobre 1.234 objetos de trece páginas
 * repartidas: **91,9% con inventario, 33,6% con imagen y con inventario**, o
 * sea ~70.000 objetos cruzables y no ~107.000. Sigue mereciendo la pena, pero
 * la cifra de agosto era optimista. Ojo con la página 1, que es atípica: sus
 * cien objetos no tienen número de inventario y solo uno trae imagen, así que
 * una sonda que mire solo el principio concluye que la API se ha roto.
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

/**
 * URL de imagen a partir de la base IIIF.
 *
 * Dos cosas medidas contra su servidor el 31 de agosto de 2026, y las dos
 * rompían todas las URLs que este fichero construía:
 *
 * 1. **Las bases acaban en barra** —24 de 24 en la muestra—, así que añadirle
 *    `/full/…` dejaba una barra doble.
 *
 * 2. **`1280,` devuelve 501 siempre.** Es un IIIF de nivel 1 y solo sirve
 *    anchos hasta cerca del mayor tamaño que declara en su `info.json`, que
 *    depende de cada imagen: se midieron topes de 800, 700 y menos de 700 en
 *    tres obras. Un ancho fijo grande no vale para todas.
 *
 * Por eso el tamaño por defecto es `full`, el original: responde en las 24 de
 * la muestra, pesa 0,1-0,2 MB porque vienen ya comprimidas, y es lo mismo que
 * guarda el resto del catálogo, que enlaza los originales de Commons. Los
 * anchos concretos siguen aquí para miniaturas —250 y 500 respondieron en todas
 * las probadas—, pero conviene medir antes de subir de 500.
 */
export function iiifImage(base: string, size: 250 | 500 | 'full' = 'full'): string {
  // Sirven por http; se fuerza https para no romper la página con contenido mixto.
  const raiz = base.replace(/^http:/, 'https:').replace(/\/+$/, '');
  return `${raiz}/full/${size === 'full' ? 'full' : `${size},`}/0/default.jpg`;
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
