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
    for (const radio of RADIOS) {
      const works = await artworksNear(lang, lat, lng, radio);

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
