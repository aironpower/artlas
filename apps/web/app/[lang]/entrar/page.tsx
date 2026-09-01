import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, type Lang } from '@/lib/i18n';
import { currentUser } from '@/lib/auth';
import { entrar } from '@/lib/cuenta-acciones';
import { BotonesProveedor } from '@/components/BotonesProveedor';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; volver?: string }>;
}

/**
 * Entrar.
 *
 * Tres formas y **ninguna es el enlace mágico al correo**, que estuvo aquí
 * hasta el 1 de septiembre de 2026 y se quitó por dos motivos. Uno: con
 * contraseña, Google y GitHub ya no aporta nada, y una pantalla con cuatro
 * formas de entrar es una pantalla que hay que explicar. Dos: era la que peor
 * funcionaba, porque depende del límite de correos de Supabase —2 o 3 por
 * hora con su SMTP de serie—. El correo se queda para lo que solo él puede
 * hacer: confirmar una dirección y recuperar una contraseña.
 *
 * Los proveedores van arriba. Quien tiene cuenta de Google entra de un clic, y
 * ponerlos debajo obliga a leer antes un formulario que no va a rellenar.
 *
 * Y hay un solo mensaje de error para «ese correo no existe» y «la contraseña
 * está mal». Dos mensajes distintos convierten esta pantalla en un comprobador
 * de qué direcciones tienen cuenta.
 */
export default async function Entrar({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const sp = await searchParams;

  // Con sesión no se enseña esta pantalla: al sitio del que se venía.
  if (await currentUser()) redirect(sp.volver || `/${idioma}`);

  const base = path(idioma, 'login');

  return (
    <div className="login">
      <h1>{t(idioma, 'signIn')}</h1>

      {sp.error === 'proveedor' && <p className="aviso aviso-mal">{t(idioma, 'signUpFailed')}</p>}
      {sp.error === 'cancelado' && <p className="aviso aviso-mal">{t(idioma, 'signInCancelled')}</p>}
      {sp.error === 'enlace' && <p className="aviso aviso-mal">{t(idioma, 'linkExpired')}</p>}
      {sp.error === '1' && <p className="aviso aviso-mal">{t(idioma, 'signInFailed')}</p>}

      <BotonesProveedor idioma={idioma} volver={sp.volver} />

      <p className="separador"><span>{t(idioma, 'orByEmail')}</span></p>

      <form action={entrar}>
        <input type="hidden" name="lang" value={idioma} />
        <input type="hidden" name="volver" value={sp.volver ?? ''} />
        <input type="email" name="email" required placeholder="tu@correo.com" autoComplete="email" />
        <input
          type="password" name="password" required
          placeholder={t(idioma, 'password')} autoComplete="current-password"
        />
        <button className="btn btn-primary" type="submit">{t(idioma, 'signIn')}</button>
      </form>

      {/*
        * Un solo enlace, y solo para quien ha perdido la contraseña. No es una
        * segunda forma de entrar puesta de otra manera: si estuviera al mismo
        * nivel que el botón, la gente lo usaría como atajo para no recordarla
        * y volveríamos a depender del correo en cada acceso.
        */}
      <p className="small" style={{ paddingTop: 14 }}>
        <Link href={`${base}/recuperar`}>{t(idioma, 'forgotPassword')}</Link>
      </p>

      <p className="small pie-cuenta">
        {t(idioma, 'noAccountYet')}{' '}
        <Link href={`${base}/registro${sp.volver ? `?volver=${encodeURIComponent(sp.volver)}` : ''}`}>
          {t(idioma, 'createOne')}
        </Link>
      </p>

    </div>
  );
}
