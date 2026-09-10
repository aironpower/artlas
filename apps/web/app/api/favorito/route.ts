import { NextResponse } from 'next/server';
import { esFavorita } from '@/lib/favoritos';

/**
 * ¿Está esta obra entre los favoritos de quien mira?
 *
 * Aparte de `/api/sesion` y no un parámetro suyo, porque son dos preguntas con
 * dos costes distintos: la sesión se pregunta en TODAS las páginas y esto solo
 * en la ficha de una obra, y solo cuando ya se sabe que hay alguien dentro. Un
 * visitante anónimo no llega hasta aquí: `BotonFavorito` le pinta el enlace de
 * entrar sin preguntar nada.
 *
 * No hace falta comprobar permisos: `esFavorita` consulta con la sesión del
 * visitante, así que la política de `favorites` solo le deja ver las suyas.
 */
export const dynamic = 'force-dynamic';

export async function GET(peticion: Request) {
  const obra = Number(new URL(peticion.url).searchParams.get('obra'));

  if (!Number.isInteger(obra) || obra < 1) {
    return NextResponse.json({ error: 'obra no válida' }, { status: 400 });
  }

  return NextResponse.json(
    { guardada: await esFavorita(obra) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
