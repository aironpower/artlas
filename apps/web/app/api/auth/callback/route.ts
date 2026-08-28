import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Vuelta del enlace mágico.
 *
 * Aquí SÍ se pueden escribir cookies —es un route handler, no un componente de
 * servidor—, y por eso el intercambio del código por la sesión vive aquí y no
 * en la página: es el único sitio de la app donde se puede dejar la sesión
 * guardada.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const destino = searchParams.get('next') ?? '/es/admin';

  if (!code) {
    return NextResponse.redirect(`${origin}/es/admin/entrar`);
  }

  const response = NextResponse.redirect(`${origin}${destino}`);

  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const { error } = await db.auth.exchangeCodeForSession(code);

  /*
   * Si el código no vale —caducado, ya usado, manipulado— se vuelve a la
   * pantalla de entrada sin decir por qué. El detalle solo le sirve a quien
   * esté probando códigos.
   */
  if (error) return NextResponse.redirect(`${origin}/es/admin/entrar`);

  return response;
}
