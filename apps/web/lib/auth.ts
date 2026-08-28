/**
 * Sesión del usuario y comprobación de administrador.
 *
 * Todo lo de aquí usa la ANON key con la sesión del visitante, nunca la
 * service_role. Es lo que hace que las políticas RLS de `0020` se apliquen: si
 * el panel leyera con service_role, la base no comprobaría nada y la única
 * protección sería el `if` de un componente.
 *
 * Dicho de otro modo: `requireAdmin()` NO es la garantía de seguridad, es
 * comodidad para poder devolver un 404 limpio. La garantía es que las
 * políticas de la base no devuelven una sola fila a quien no es administrador,
 * aunque llame a la API con su propia sesión y se salte la web entera.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { notFound } from 'next/navigation';

export async function supabaseServer() {
  const store = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        /*
         * En un componente de servidor no se pueden escribir cookies, y Next
         * lanza si se intenta. La renovación del token la hace la ruta de
         * callback, que sí puede; aquí solo se lee. Tragarse el error es lo
         * correcto y no un parche: el patrón viene de la documentación de
         * @supabase/ssr.
         */
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch { /* componente de servidor: solo lectura */ }
      },
    },
  });
}

export interface AdminSession {
  userId: string;
  email: string | null;
}

/** La sesión actual, o null si no hay nadie identificado. */
export async function currentUser(): Promise<AdminSession | null> {
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();

  return data.user ? { userId: data.user.id, email: data.user.email ?? null } : null;
}

/**
 * Exige perfil de administrador o hace desaparecer la página.
 *
 * Se devuelve 404 y no 403 a propósito: un 403 confirma que la ruta existe, y
 * el panel de administración no tiene por qué anunciarse a quien no entra.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const user = await currentUser();
  if (!user) notFound();

  const db = await supabaseServer();
  const { data, error } = await db.rpc('is_admin');

  if (error || data !== true) notFound();

  return user;
}
