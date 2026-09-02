/**
 * Buscar un sitio por su nombre: «Museo del Prado», «Florencia», una calle.
 *
 * Va por el servidor y no directamente desde el navegador por dos motivos, y
 * ninguno es de comodidad.
 *
 * Uno: Nominatim —el buscador de OpenStreetMap— exige que cada petición diga
 * quién la hace, con un `User-Agent` que identifique la aplicación y una forma
 * de contacto. Desde el navegador ese encabezado no se puede poner: lo fija el
 * navegador y no se deja tocar. Llamando desde aquí sí, y así cumplimos su
 * política en vez de colarnos de anónimos.
 *
 * Dos: pasa por nuestra caché. El mismo «Florencia» lo van a escribir muchas
 * personas, y responderlo desde la caché de Vercel es no molestar a un servicio
 * gratuito que nos deja usarlo por buena voluntad.
 *
 * Es un servicio de terceros sin contrato, igual que las teselas del mapa. Si
 * un día no responde, la caja de búsqueda no encuentra nada y el mapa se sigue
 * pudiendo pinchar con el dedo, que es la otra forma de elegir un punto.
 */

import { NextResponse } from 'next/server';
import { isLang } from '@/lib/i18n';

/** Una hora en caché, y un día sirviendo lo viejo mientras se revalida. */
export const revalidate = 3600;

const CONTACTO = 'https://artlas.softie.dev';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const q = (params.get('q') ?? '').trim();
  const lang = params.get('lang') ?? '';

  if (!isLang(lang)) {
    return NextResponse.json({ error: 'idioma desconocido' }, { status: 400 });
  }

  /*
   * Menos de tres letras no es una búsqueda: es alguien escribiendo. Cortarlo
   * aquí evita mandar a Nominatim una petición por pulsación, que es
   * exactamente lo que su política pide no hacer.
   */
  if (q.length < 3) return NextResponse.json({ lugares: [] });
  if (q.length > 120) return NextResponse.json({ error: 'consulta larga' }, { status: 400 });

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  // Los resultados vienen en el idioma de quien busca cuando existe traducción.
  url.searchParams.set('accept-language', lang);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': `Artlas/0.1 (${process.env.NEXT_PUBLIC_SITE_URL || CONTACTO})`,
        'Accept': 'application/json',
      },
      // 8 s: si tarda más, el buscador de sitios no vale la pena y el mapa
      // sigue estando ahí para pinchar.
      signal: AbortSignal.timeout(8_000),
      next: { revalidate },
    });

    if (!res.ok) return NextResponse.json({ lugares: [] });

    const crudo = await res.json() as {
      display_name?: string; lat?: string; lon?: string; type?: string;
    }[];

    const lugares = (Array.isArray(crudo) ? crudo : [])
      .map((r) => ({
        nombre: String(r.display_name ?? ''),
        lat: Number(r.lat),
        lng: Number(r.lon),
      }))
      // Nominatim devuelve las coordenadas como texto; una fila sin números
      // válidos llegaría al mapa como NaN y lo dejaría en blanco.
      .filter((l) => l.nombre && Number.isFinite(l.lat) && Number.isFinite(l.lng));

    return NextResponse.json({ lugares });
  } catch {
    // Que no encuentre no es un error de la página: se responde vacío y quien
    // busca sigue pudiendo pinchar el mapa.
    return NextResponse.json({ lugares: [] });
  }
}
