import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { DEFAULT_LANG, isLang } from '@/lib/i18n';
import { path } from '@/lib/routes';

/**
 * La vuelta de todo lo que sale de la web y regresa con una sesión.
 *
 * Son tres caminos y acaban aquí los tres: confirmar el correo al registrarse,
 * volver de Google o de GitHub, y el enlace para poner una contraseña nueva.
 *
 * Está en un route handler y no en una página porque **es el único sitio de la
 * app donde se pueden escribir cookies**. Un componente de servidor no puede, y
 * la sesión es una cookie.
 */

/**
 * A dónde mandar a alguien después de entrar.
 *
 * Solo rutas de esta web. Sin esta comprobación, `?next=https://otrositio` sería
 * un redirector abierto colgado de nuestro dominio: alguien manda ese enlace,
 * la víctima ve `artlas.softie.dev` y acaba en otro sitio, ya autenticada.
 * Se exige una barra inicial y se rechaza `//`, que el navegador interpreta
 * como dominio externo.
 */
function destinoSeguro(crudo: string | null): string {
  if (!crudo || !crudo.startsWith('/') || crudo.startsWith('//')) return `/${DEFAULT_LANG}`;
  return crudo;
}

/** El idioma que llevaba el destino, para no devolver a nadie a otro idioma. */
function idiomaDe(destino: string) {
  const primero = destino.split('/')[1] ?? '';
  return isLang(primero) ? primero : DEFAULT_LANG;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const destino = destinoSeguro(searchParams.get('next'));
  const idioma = idiomaDe(destino);
  const entrada = `${origin}${path(idioma, 'login')}`;

  /*
   * El proveedor puede decir que no —alguien pulsa «cancelar» en la pantalla de
   * Google— y entonces no llega ningún código, sino `error`. Antes esto caía en
   * el mismo saco que «código inválido» y devolvía a la entrada sin más; sigue
   * devolviendo, pero contándolo, porque una vuelta silenciosa a la pantalla de
   * entrar parece que la web se ha estropeado.
   */
  const fallo = searchParams.get('error');
  if (fallo) {
    return NextResponse.redirect(
      `${entrada}?error=${fallo === 'access_denied' ? 'cancelado' : 'proveedor'}`,
    );
  }

  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(`${entrada}?error=1`);

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
   * pantalla de entrada sin decir cuál de las tres cosas. El detalle solo le
   * sirve a quien esté probando códigos.
   *
   * Caducado es el caso corriente y no el raro: los enlaces del correo duran
   * una hora, y a quien abre el correo al día siguiente le pasa esto.
   */
  if (error) return NextResponse.redirect(`${entrada}?error=enlace`);

  return response;
}
