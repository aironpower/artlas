import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, type Lang } from '@/lib/i18n';
import { currentUser } from '@/lib/auth';
import { registrarse } from '@/lib/cuenta-acciones';
import { BotonesProveedor } from '@/components/BotonesProveedor';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; hecho?: string; volver?: string }>;
}

/**
 * Crear una cuenta.
 *
 * Es la misma pantalla que entrar con el verbo cambiado, y eso es a propósito:
 * con Google o GitHub, registrarse y entrar son literalmente el mismo botón —el
 * proveedor ya sabe quién eres y la cuenta se crea sola la primera vez—. Lo
 * único que cambia de verdad es el formulario de correo, que aquí pide una
 * contraseña nueva en vez de la de siempre.
 *
 * Los errores NO se disimulan, y es lo contrario de lo que hacía la pantalla
 * vieja. Si el registro está cerrado en Supabase o el correo no sale, se dice:
 * la persona no puede hacer nada al respecto y mandarla a revisar su bandeja
 * la deja esperando algo que no va a llegar. Eso es exactamente lo que pasó el
 * 1 de septiembre de 2026.
 */
export default async function Registro({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const sp = await searchParams;

  if (await currentUser()) redirect(sp.volver || `/${idioma}`);

  const base = path(idioma, 'login');

  return (
    <div className="login">
      <h1>{t(idioma, 'signUp')}</h1>

      {sp.hecho ? (
        <>
          <p className="aviso aviso-bien">{t(idioma, 'signUpDone')}</p>
          <p className="small" style={{ paddingTop: 14 }}>
            <Link href={base}>{t(idioma, 'signIn')}</Link>
          </p>
        </>
      ) : (
        <>
          {sp.error === 'cerrado' && <p className="aviso aviso-mal">{t(idioma, 'signUpClosed')}</p>}
          {sp.error === 'correo' && <p className="aviso aviso-mal">{t(idioma, 'mailFailed')}</p>}
          {sp.error === 'direccion' && <p className="aviso aviso-mal">{t(idioma, 'emailInvalid')}</p>}
          {sp.error === 'corta' && <p className="aviso aviso-mal">{t(idioma, 'passwordShort')}</p>}
          {sp.error === '1' && <p className="aviso aviso-mal">{t(idioma, 'signUpFailed')}</p>}

          <BotonesProveedor idioma={idioma} volver={sp.volver} />

          <p className="separador"><span>{t(idioma, 'orByEmail')}</span></p>

          <form action={registrarse}>
            <input type="hidden" name="lang" value={idioma} />
            <input type="email" name="email" required placeholder="tu@correo.com" autoComplete="email" />
            <input
              type="password" name="password" required minLength={10}
              placeholder={t(idioma, 'password')} autoComplete="new-password"
            />
            <button className="btn btn-primary" type="submit">{t(idioma, 'signUp')}</button>
          </form>

          <p className="muted small" style={{ paddingTop: 12 }}>{t(idioma, 'passwordHint')}</p>

          <p className="small pie-cuenta">
            {t(idioma, 'haveAccount')}{' '}
            <Link href={`${base}${sp.volver ? `?volver=${encodeURIComponent(sp.volver)}` : ''}`}>
              {t(idioma, 'signIn')}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
