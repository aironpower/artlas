/**
 * Una consulta al día para que Supabase no pause el proyecto.
 *
 * El plan gratuito pausa la base tras 7 días sin actividad, y con la web
 * cerrada a los buscadores puede pasar una semana sin una sola visita. Pasó en
 * otoño de 2026: la base estaba pausada y la web no cargaba.
 *
 * La llama el cron de `vercel.json` una vez al día, que es lo máximo que
 * permite el plan Hobby. Vercel manda `Authorization: Bearer <CRON_SECRET>`
 * cuando esa variable existe en el proyecto; sin ella la ruta no hace nada,
 * para que nadie de fuera pueda usarla para generar tráfico.
 */

import { NextResponse } from 'next/server';
import { countArtists } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  try {
    const artistas = await countArtists();
    return NextResponse.json({ ok: true, artistas });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
