/**
 * Comprobación de que la imagen de una obra se ve de verdad.
 *
 * Dos decisiones que vienen de haberlo hecho mal antes:
 *
 * 1. **Se pide la miniatura, no la imagen original.** La URL que guarda el
 *    catálogo es un `Special:FilePath` de Commons, que ni el navegador carga
 *    (bloqueo de hotlinking y ORB). Lo que hay que verificar es exactamente lo
 *    que la web pide, así que se importa `imageUrl` de la app en vez de
 *    reconstruirla aquí. Si se copiara, las dos versiones acabarían
 *    divergiendo y el auditor daría por buena una imagen que la página no
 *    puede mostrar — que es literalmente el fallo que dejó 86 obras sin
 *    imagen.
 *
 * 2. **Un 429 NO es una imagen rota.** En la primera pasada le metí 150
 *    peticiones seguidas a Commons, me devolvió 429 en 126 y estuve a punto de
 *    dar por rotas casi todas las imágenes del catálogo. Wikimedia limita por
 *    ritmo, no por fichero. Por eso aquí se va despacio, se reintenta con
 *    esperas crecientes, y si aun así llega un 429 el resultado es `unknown`:
 *    no se afirma nada. Un auditor que inventa problemas es peor que no tener
 *    auditor.
 */

import { imageUrl } from '../../../../apps/web/lib/images.js';

export type ImageVerdict = 'ok' | 'broken' | 'unknown';

export interface ImageCheck {
  verdict: ImageVerdict;
  detail: string;
}

/*
 * Ritmo. Los valores no son gusto personal: la primera pasada iba a 4 a la vez
 * con 250 ms y de 6.460 imágenes se quedaron 3.071 sin veredicto por 429. Ir
 * más despacio no es ser tímido, es la diferencia entre auditar y no auditar.
 */
const CONCURRENCY = 2;
const PAUSE_MS = 400;

/*
 * Y cuando aun así llega el 429, se espera de verdad. Un solo reintento a los
 * 3 segundos era optimista: el límite de Wikimedia se mide en minutos, no en
 * segundos. Tres intentos con esperas crecientes recuperan casi todo.
 */
const BACKOFFS_MS = [5000, 20000, 60000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string, userAgent: string): Promise<Response> {
  return fetch(url, {
    // Rango de un byte: confirma que el fichero existe y de qué tipo es, sin
    // descargarse 6.000 imágenes enteras.
    headers: { 'User-Agent': userAgent, Range: 'bytes=0-0' },
    redirect: 'follow',
  });
}

export async function checkImage(raw: string, userAgent: string): Promise<ImageCheck> {
  const url = imageUrl(raw, 500);
  if (!url) return { verdict: 'broken', detail: 'sin URL' };

  try {
    let res = await fetchOnce(url, userAgent);

    for (const espera of BACKOFFS_MS) {
      if (res.status !== 429) break;
      await sleep(espera);
      res = await fetchOnce(url, userAgent);
    }

    if (res.status === 429) {
      return { verdict: 'unknown', detail: 'limitado por ritmo (429) tras tres esperas' };
    }

    if (!res.ok) {
      return { verdict: 'broken', detail: `HTTP ${res.status} en ${url.slice(0, 120)}` };
    }

    /*
     * Un 200 no basta. Cuando Commons no sabe generar la miniatura devuelve
     * `text/html` con la página de error, y el navegador enseña un hueco igual
     * que con un 404. Es lo que pasaba con los TIFF.
     */
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) {
      return { verdict: 'broken', detail: `content-type ${type || 'desconocido'} en vez de imagen` };
    }

    return { verdict: 'ok', detail: type };
  } catch (err) {
    // Un fallo de red tampoco es una imagen rota: puede ser nuestra conexión.
    return { verdict: 'unknown', detail: `error de red: ${String(err).slice(0, 80)}` };
  }
}

/**
 * Comprueba una lista de obras a ritmo sostenible.
 *
 * `onProgress` recibe cuántas van, para que una pasada de 6.000 imágenes no
 * parezca colgada durante media hora.
 */
export async function checkImages<T extends { id: number; image_url: string | null }>(
  works: T[],
  userAgent: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, ImageCheck>> {
  const results = new Map<number, ImageCheck>();
  let done = 0;

  for (let i = 0; i < works.length; i += CONCURRENCY) {
    const batch = works.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (work) => {
      if (!work.image_url) return;                 // ya lo caza `image_missing`
      results.set(work.id, await checkImage(work.image_url, userAgent));
    }));

    done += batch.length;
    onProgress?.(done, works.length);
    await sleep(PAUSE_MS);
  }

  return results;
}
