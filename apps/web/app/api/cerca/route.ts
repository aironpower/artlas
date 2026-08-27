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

  try {
    const works = await artworksNear(lang, lat, lng, 15_000);
    return NextResponse.json(
      works.map((w) => ({ ...w, image_url: imageUrl(w.image_url, 500) })),
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
