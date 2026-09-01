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

/* ---------------------------------------------------------------------------
 * Por lotes, preguntándole a Commons en vez de descargar una a una.
 *
 * Descargar imagen a imagen no escala y está medido: Wikimedia deja pasar unas
 * once peticiones seguidas y a partir de ahí devuelve 429 en el acto, así que
 * con los reintentos la media salía a 3 s por imagen. Las 125.000 del catálogo
 * eran tres días y medio de máquina.
 *
 * Su API contesta por 50 ficheros de una vez y dice, para cada uno, si existe y
 * cuál es la miniatura de 500 px. Medido: 100 obras en 1,2 s con 2 peticiones,
 * donde antes eran cinco minutos.
 * ------------------------------------------------------------------------- */

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const POR_LOTE = 50;                 // el tope de `titles` para un cliente normal
const PAUSA_LOTE_MS = 300;

const ES_COMMONS = /\/wiki\/Special:FilePath\//;
const NOMBRE_COMMONS = /\/wiki\/Special:FilePath\/(.+)$/;

/** El título con el que Commons conoce el fichero: `File:Nombre con espacios.jpg`. */
function tituloCommons(raw: string): string | null {
  const m = NOMBRE_COMMONS.exec(raw);
  if (!m?.[1]) return null;
  try {
    return `File:${decodeURIComponent(m[1]).replace(/_/g, ' ')}`;
  } catch {
    return null;                     // un porcentaje suelto en el nombre
  }
}

/**
 * La ruta, decodificada y sin host ni parámetros.
 *
 * Hace falta porque Commons devuelve hoy `thumb.wikimedia.org` con parámetros
 * de seguimiento donde nosotros construimos `upload.wikimedia.org`, y codifica
 * los paréntesis que nosotros dejamos literales. Comparar las URLs enteras
 * daba 100 de 100 distintas siendo todas la misma imagen.
 */
function rutaDe(u: string): string {
  try { return decodeURIComponent(new URL(u).pathname); } catch { return u; }
}

const extensionDe = (titulo: string) => titulo.split('.').pop()?.toLowerCase() ?? '';

/**
 * Comprueba una tanda entera: lo de Commons por lotes, lo demás una a una.
 *
 * Las que no son de Commons —las 9.894 del Nationalmuseum, las del Met— siguen
 * por descarga directa: son pocas y sus servidores no nos limitan.
 */
export async function checkImagesBatched<T extends { id: number; image_url: string | null }>(
  works: T[],
  userAgent: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, ImageCheck>> {
  const results = new Map<number, ImageCheck>();

  const deCommons = works.filter((w) => w.image_url && ES_COMMONS.test(w.image_url));
  const resto = works.filter((w) => w.image_url && !ES_COMMONS.test(w.image_url));

  /*
   * Miniaturas que no coinciden con la que declara Commons, agrupadas por
   * extensión.
   *
   * Existen porque para un `.tiff` Commons prefiere `lossless-…​.png` y
   * nosotros pedimos `lossy-…​.jpg`; para un `.webp`, él añade `.png` y
   * nosotros no. Comprobado a mano: **las dos cargan**, son renderizados
   * equivalentes del mismo fichero. Así que una ruta distinta NO es una imagen
   * rota, y darla por rota marcaría miles de obras buenas.
   *
   * Pero tampoco se puede dar por buena sin más: el fallo que dejó 86 obras sin
   * imagen era exactamente un sufijo mal construido. La salida es comprobar UNA
   * por extensión y aplicar el veredicto a su grupo: el sufijo lo decide la
   * extensión, así que una muestra por clase responde por todas.
   */
  const dudosas = new Map<string, { ids: number[]; url: string }>();

  let hechas = 0;

  for (let i = 0; i < deCommons.length; i += POR_LOTE) {
    const lote = deCommons.slice(i, i + POR_LOTE);
    const titulos = new Map<number, string>();
    for (const w of lote) {
      const t = tituloCommons(w.image_url!);
      if (t) titulos.set(w.id, t);
      else results.set(w.id, { verdict: 'broken', detail: 'nombre de fichero ilegible' });
    }

    if (titulos.size === 0) { hechas += lote.length; onProgress?.(hechas, works.length); continue; }

    /*
     * Por POST, y no es capricho.
     *
     * Con GET, 50 títulos hacían una URL de 8.238 caracteres y Wikimedia
     * respondía **414 URI Too Long**: las obras de estampas del Met llevan
     * títulos de hasta 226 caracteres —«Title Page, The Caricature Magazine by
     * G[eorge] Cruikshank…»— y cincuenta no caben. El lote entero se quedaba
     * sin veredicto y volvía a intentarse en cada pasada, para siempre: 101
     * imágenes atascadas que ninguna pasada podía resolver.
     *
     * La API de MediaWiki acepta POST para consultas de lectura y ahí no hay
     * tope de longitud. Comprobado: el mismo lote que daba 414 devuelve sus 50.
     */
    const cuerpo = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '500',
      titles: [...new Set(titulos.values())].join('|'),
    });

    let json: any;
    try {
      const res = await fetch(COMMONS_API, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: cuerpo.toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (err) {
      // Un lote caído no afirma nada de sus 50 obras: se quedan en la cola.
      for (const id of titulos.keys()) {
        results.set(id, { verdict: 'unknown', detail: `lote fallido: ${String(err).slice(0, 60)}` });
      }
      hechas += lote.length; onProgress?.(hechas, works.length);
      await sleep(PAUSA_LOTE_MS);
      continue;
    }

    const porTitulo = new Map<string, any>();
    for (const p of json.query?.pages ?? []) porTitulo.set(p.title, p);
    // Commons normaliza los títulos (mayúsculas, espacios) y dice cómo.
    const normalizado = new Map<string, string>();
    for (const n of json.query?.normalized ?? []) normalizado.set(n.from, n.to);

    for (const w of lote) {
      const titulo = titulos.get(w.id);
      if (!titulo) continue;

      const pagina = porTitulo.get(normalizado.get(titulo) ?? titulo);
      if (!pagina) { results.set(w.id, { verdict: 'unknown', detail: 'Commons no contestó por este fichero' }); continue; }
      if (pagina.missing) { results.set(w.id, { verdict: 'broken', detail: 'el fichero no existe en Commons' }); continue; }

      const suya = pagina.imageinfo?.[0]?.thumburl;
      const nuestra = imageUrl(w.image_url!, 500);
      if (!suya || !nuestra) { results.set(w.id, { verdict: 'unknown', detail: 'sin miniatura declarada' }); continue; }

      if (rutaDe(suya) === rutaDe(nuestra)) {
        results.set(w.id, { verdict: 'ok', detail: pagina.imageinfo[0].thumbmime ?? 'image' });
        continue;
      }

      const ext = extensionDe(titulo);
      const grupo = dudosas.get(ext) ?? { ids: [], url: nuestra };
      grupo.ids.push(w.id);
      dudosas.set(ext, grupo);
    }

    hechas += lote.length;
    onProgress?.(hechas, works.length);
    await sleep(PAUSA_LOTE_MS);
  }

  // Una descarga por extensión decide todo su grupo.
  for (const [ext, grupo] of dudosas) {
    const prueba = await checkImage(
      // `checkImage` vuelve a construir la URL, así que se le pasa la original.
      deCommons.find((w) => w.id === grupo.ids[0])!.image_url!, userAgent);

    const detalle = prueba.verdict === 'ok'
      ? `miniatura distinta a la que declara Commons, pero carga (.${ext})`
      : `miniatura mal construida para .${ext}: ${prueba.detail}`;

    for (const id of grupo.ids) results.set(id, { verdict: prueba.verdict, detail: detalle });
  }

  // Y lo que no es de Commons, por el camino de siempre.
  if (resto.length > 0) {
    const sueltas = await checkImages(resto, userAgent,
      (d, t) => onProgress?.(deCommons.length + d, deCommons.length + t));
    for (const [id, check] of sueltas) results.set(id, check);
  }

  return results;
}
