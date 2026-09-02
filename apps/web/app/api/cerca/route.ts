/**
 * Obras cerca de un punto.
 *
 * Existe como ruta de servidor y no como consulta directa desde el navegador
 * porque las URLs de imagen hay que reescribirlas antes de servirlas, y esa
 * reescritura necesita MD5 (`node:crypto`), que no existe en el cliente.
 * De paso, la forma de la RPC se queda en el servidor.
 */

import { NextResponse } from 'next/server';
import { artworksNear } from '@/lib/data';
import { imageUrl } from '@/lib/images';
import { isLang } from '@/lib/i18n';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const lang = params.get('lang') ?? '';

  /*
   * Radio pedido, opcional. Sin él manda el servidor y va ampliando hasta
   * encontrar algo, que es lo que necesita «cerca de mí»: quien pulsa ese
   * botón no ha elegido una distancia, ha preguntado qué tiene al lado.
   *
   * Con él NO se amplía, y esa es la diferencia que importa. Si alguien pone
   * el círculo en 5 km y le devolviéramos obras a 300, el círculo dibujado en
   * el mapa estaría mintiendo. Vacío dentro de 5 km es una respuesta.
   */
  const radioPedido = params.get('radio');
  const radio = radioPedido === null ? null : Number(radioPedido);

  if (radio !== null && (!Number.isFinite(radio) || radio < 100 || radio > 1_000_000)) {
    return NextResponse.json({ error: 'radio inválido' }, { status: 400 });
  }

  /*
   * El texto por el que se busca dentro del radio. Se acota aquí porque llega
   * de fuera: menos de dos letras la función lo trata como si no hubiera
   * filtro, y más de 120 no es una búsqueda.
   */
  const q = (params.get('q') ?? '').trim().slice(0, 120);

  // Coordenadas de un tercero: se validan antes de llegar a PostGIS.
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 ||
      !Number.isFinite(lng) || Math.abs(lng) > 180 ||
      !isLang(lang)) {
    return NextResponse.json({ error: 'parámetros inválidos' }, { status: 400 });
  }

  /*
   * Se busca en círculos cada vez más anchos hasta encontrar algo.
   *
   * Antes se preguntaba solo por 15 km —«el radio útil de una ciudad»— y quien
   * estuviera fuera de una recibía «no hemos encontrado nada», que suena a
   * avería. Le pasó a Manuel a 150 km de Barcelona: la respuesta era cierta y
   * completamente inútil, porque lo que uno quiere saber ahí no es que no haya
   * nada al lado, sino dónde está lo más cercano.
   *
   * Cuatro consultas como mucho, y solo cuando las anteriores vuelven vacías:
   * quien esté en una ciudad con museo sigue pagando una sola.
   */
  const RADIOS = [15_000, 60_000, 250_000, 1_000_000];

  try {
    if (radio !== null) {
      const works = await artworksNear(lang, lat, lng, radio, undefined, q);
      return NextResponse.json({
        radio,
        works: works.map((w) => ({ ...w, image_url: imageUrl(w.image_url, 500) })),
      });
    }

    for (const radio of RADIOS) {
      const works = await artworksNear(lang, lat, lng, radio, undefined, q);

      if (works.length > 0 || radio === RADIOS[RADIOS.length - 1]) {
        return NextResponse.json({
          radio,
          works: works.map((w) => ({ ...w, image_url: imageUrl(w.image_url, 500) })),
        });
      }
    }

    return NextResponse.json({ radio: RADIOS[RADIOS.length - 1], works: [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
