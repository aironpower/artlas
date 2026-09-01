'use server';

/**
 * El siguiente lote de obras de un museo, ya pintado.
 *
 * Devuelve JSX y no JSON, y esa es la decisión que sostiene el fichero.
 *
 * Una tarjeta de obra no es «título más imagen»: es `ArtworkImage`, que decide
 * según `image_mode` si se enseña la reproducción, solo la miniatura del
 * proveedor con enlace obligado al museo, o un hueco explicado. Esa política
 * de derechos vive en un único componente a propósito, y es de servidor porque
 * reescribir las URL de Commons necesita MD5, que en el navegador no existe.
 *
 * Si esto devolviera JSON, el cliente tendría que volver a pintar las tarjetas
 * y, con ellas, volver a decidir qué se puede enseñar: habría dos políticas de
 * derechos, la de la primera página y la del scroll. Devolviendo el propio
 * `ArtworkGrid` hay una sola, la misma que ya se usa arriba.
 */

import type { ReactNode } from 'react';
import { artworksByInstitution } from './data';
import { isLang, type Lang } from './i18n';
import { TarjetasObra } from '@/components/ArtworkGrid';

/** Las mismas que en la primera página. Si cambia allí, cambia aquí. */
const POR_PAGINA = 36;

export interface Lote {
  nodo: ReactNode;
  hayMas: boolean;
}

export async function masObrasDelMuseo(
  slug: string,
  lang: string,
  pagina: number,
): Promise<Lote> {
  /*
   * Los tres argumentos vienen del navegador, así que se comprueban aquí. Una
   * acción de servidor es un punto de entrada público como cualquier otro: que
   * la llame nuestro componente no impide que la llame otra cosa, con la
   * página que le apetezca.
   */
  if (!isLang(lang)) throw new Error('idioma desconocido');
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 10_000) {
    throw new Error('página fuera de rango');
  }

  const idioma: Lang = lang;

  // Una obra más de las que caben: si vuelve, queda otra página. Igual que en
  // la primera, y por lo mismo: es más barato que contar.
  const lote = await artworksByInstitution(
    idioma, slug, POR_PAGINA + 1, (pagina - 1) * POR_PAGINA,
  );

  const obras = lote.slice(0, POR_PAGINA);

  /*
   * Tarjetas sueltas, sin rejilla: caen dentro de la que ya hay arriba, para
   * que el lote nuevo no empiece su propia cuadrícula y deje una costura.
   */
  return {
    nodo: obras.length > 0 ? <TarjetasObra lang={idioma} items={obras} /> : null,
    hayMas: lote.length > POR_PAGINA,
  };
}
