import Link from 'next/link';
import { redirect } from 'next/navigation';
import { t, type Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';
import { currentUser, supabaseServer, viewerIsAdmin } from '@/lib/auth';

/**
 * Lo de la cuenta en la barra de secciones: entrar, o tus favoritos y salir.
 *
 * Va en el servidor porque la sesión vive en una cookie que solo él lee. Eso
 * obliga a que el `layout` sea dinámico, y por eso no se pinta en la barra
 * superior sino en esta fila: así lo dinámico queda acotado a un componente y
 * las páginas siguen sirviéndose con su caché.
 */
export async function Cuenta({ lang }: { lang: Lang }) {
  const usuario = await currentUser();

  if (!usuario) {
    return <Link href={path(lang, 'login')}>{t(lang, 'signIn')}</Link>;
  }

  const admin = await viewerIsAdmin();

  async function salir() {
    'use server';
    const db = await supabaseServer();
    await db.auth.signOut();
    redirect(`/${lang}`);
  }

  return (
    <>
      <Link href={path(lang, 'favorites')}>{t(lang, 'myFavorites')}</Link>
      {admin && <Link href={path(lang, 'admin')}>{t(lang, 'adminPanel')}</Link>}
      <form action={salir} style={{ display: 'inline' }}>
        <button className="enlace" type="submit">{t(lang, 'signOut')}</button>
      </form>
    </>
  );
}
