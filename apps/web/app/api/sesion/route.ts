import { NextResponse } from 'next/server';
import { currentUser, viewerIsAdmin } from '@/lib/auth';

/**
 * Quién mira, para el navegador.
 *
 * Existe porque lo de la cuenta NO puede pintarse en el servidor: la cookie de
 * sesión describe a UNA persona, y el HTML de una página de catálogo se guarda
 * en la caché del CDN para todas. Mientras `Cuenta` fue un componente de
 * servidor, esa lectura de cookie descartaba el render estático de la ruta
 * entera —`revalidate` quedaba ignorado— y las 232.000 páginas del catálogo se
 * renderizaban de nuevo en cada visita. Medido el 9 de septiembre de 2026:
 * 1,7 millones de invocaciones al mes contra 691 escrituras de caché.
 *
 * Y no era solo caro: si alguna de esas páginas hubiera llegado a cachearse,
 * habría servido el «Salir» de quien pasó primero a todos los demás.
 *
 * La regla que queda: lo que depende de quién mira se pide desde el navegador,
 * nunca se pinta en un HTML que se va a compartir.
 */
export const dynamic = 'force-dynamic';

export interface Sesion {
  haySesion: boolean;
  admin: boolean;
}

export async function GET() {
  const usuario = await currentUser();

  const cuerpo: Sesion = usuario
    ? { haySesion: true, admin: await viewerIsAdmin() }
    : { haySesion: false, admin: false };

  return NextResponse.json(cuerpo, {
    /*
     * `private` para que ninguna caché intermedia —ni la del CDN, ni un proxy
     * de empresa— guarde esto: describe a una persona. `no-store` además evita
     * que el propio navegador lo reutilice tras salir de la cuenta.
     */
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
