/**
 * URLs de imagen de Wikimedia Commons.
 *
 * Wikidata da la imagen de una obra como una URL de `Special:FilePath`, que es
 * un redirector al archivo original. Esa URL NO sirve para mostrar la imagen en
 * una web, por dos motivos que costó descubrir:
 *
 * 1. Wikimedia bloquea el hotlinking de originales. Devuelve 429 con un mensaje
 *    explícito: "use thumbnail images in sizes listed on https://w.wiki/GHai".
 *
 * 2. Aunque no bloqueara, la cadena de redirecciones pasa por respuestas con
 *    `content-type: text/html` y `x-content-type-options: nosniff`, y el
 *    navegador las descarta enteras por ORB (Opaque Response Blocking). En la
 *    consola aparece `ERR_BLOCKED_BY_ORB` y la imagen no carga nunca.
 *
 * La solución es construir la URL directa de la miniatura, que Wikimedia sí
 * sirve. La ruta se deriva del MD5 del nombre de fichero, que es como Commons
 * reparte los archivos en directorios:
 *
 *     md5("Las_Meninas...jpg") = "3155ab..."
 *     -> /wikipedia/commons/thumb/3/31/Las_Meninas...jpg/500px-Las_Meninas...jpg
 *
 * Y OJO con el ancho: solo se aceptan algunos. Comprobado sobre varias obras,
 * 250, 500 y 1280 funcionan mientras que 1000 y 1500 devuelven 400. Por eso
 * `ThumbWidth` es un tipo cerrado y no un número cualquiera: pedir 1000 no da
 * una imagen peor, da un error.
 */

import { createHash } from 'node:crypto';

/** Anchos verificados contra upload.wikimedia.org. No inventar otros. */
export type ThumbWidth = 250 | 500 | 1280;

const COMMONS_FILEPATH = /\/wiki\/Special:FilePath\/(.+)$/;

/**
 * Convierte una URL de imagen en una que el navegador pueda cargar.
 * Las que no son de Commons (Met, Art Institute) se devuelven tal cual: sus
 * APIs ya dan URLs directas y servibles.
 */
export function imageUrl(raw: string | null, width: ThumbWidth = 500): string | null {
  if (!raw) return null;

  const match = COMMONS_FILEPATH.exec(raw);
  if (!match?.[1]) return raw;

  // El nombre viene percent-encoded en la URL y con espacios; Commons calcula
  // el hash sobre el nombre decodificado y con guiones bajos.
  let filename: string;
  try {
    filename = decodeURIComponent(match[1]).replace(/ /g, '_');
  } catch {
    // Un porcentaje suelto en el nombre rompe decodeURIComponent. Mejor
    // devolver la original que romper la página entera por una obra.
    return raw;
  }

  const hash = createHash('md5').update(filename).digest('hex');
  const encoded = encodeURIComponent(filename);
  const dir = `${hash[0]}/${hash.slice(0, 2)}/${encoded}`;

  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${dir}/${thumbName(filename, width, encoded)}`;
}

/**
 * Nombre del fichero de miniatura, que NO es `<ancho>px-<nombre>` para todos
 * los formatos.
 *
 * Commons no puede servir un TIFF ni un SVG a un navegador, así que los
 * rasteriza, y el resultado lleva otro nombre y otra extensión. Dar por bueno
 * el patrón de siempre devolvía un 400 con `content-type: text/html`, que en la
 * página se ve como una obra sin imagen. Eran 86 obras del catálogo, casi todas
 * del Nationalmuseum sueco, que publica sus fondos en TIFF.
 *
 * Comprobado contra upload.wikimedia.org: para un `.tif`, `lossy-page1-500px-
 * <nombre>.jpg` devuelve un JPEG de 30 KB donde `500px-<nombre>` devuelve 400.
 * El PNG también existe pero pesa siete veces más, así que para fotografía de
 * cuadros se prefiere el JPEG; para SVG, que es dibujo plano, al revés.
 */
function thumbName(filename: string, width: ThumbWidth, encoded: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'tif' || ext === 'tiff') return `lossy-page1-${width}px-${encoded}.jpg`;
  if (ext === 'svg') return `${width}px-${encoded}.png`;
  if (ext === 'pdf' || ext === 'djvu') return `page1-${width}px-${encoded}.jpg`;

  return `${width}px-${encoded}`;
}
