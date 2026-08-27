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

  return 'https://upload.wikimedia.org/wikipedia/commons/thumb/' +
         `${hash[0]}/${hash.slice(0, 2)}/${encoded}/${width}px-${encoded}`;
}
