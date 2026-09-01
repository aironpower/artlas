import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, type Lang } from '@/lib/i18n';
import { currentUser, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ enviado?: string; error?: string; volver?: string }>;
}

/**
 * Entrada, por contraseña o por enlace al correo.
 *
 * Antes vivía en `/admin/entrar` y se llamaba «Panel de revisión», porque el
 * único motivo para identificarse era administrar. Desde que hay favoritos lo
 * hace cualquiera, así que la pantalla es de la web y no del panel.
 *
 * **Las dos formas conviven a propósito.** El enlace al correo es lo bueno para
 * quien entra dos veces al año: no hay contraseña que recordar ni que perder, y
 * registrarse es lo mismo que entrar. La contraseña es para quien entra a
 * diario —Manuel administrando—, porque esperar un correo cada vez para
 * corregir un título es fricción pura.
 *
 * Nadie tiene contraseña hasta que se la pone desde `/entrar/clave`, ya dentro.
 * Así no hay que inventarle una a nadie ni mandarla por ningún sitio.
 */
export default async function Entrar({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const sp = await searchParams;

  // Con sesión no se enseña esta pantalla: al sitio del que se venía.
  if (await currentUser()) redirect(sp.volver || `/${idioma}`);

  const base = path(idioma, 'login');

  async function conEnlace(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    if (!email) return;

    const db = await supabaseServer();
    await db.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3111'}/api/auth/callback`,
      },
    });

    /*
     * Se redirige igual haya funcionado o no, y con el mismo mensaje.
     * Distinguir «correo enviado» de «ese correo no existe» convierte esta
     * pantalla en un comprobador de quién tiene cuenta.
     */
    redirect(`${base}?enviado=1`);
  }

  async function conClave(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    if (!email || !password) return;

    const db = await supabaseServer();
    const { error } = await db.auth.signInWithPassword({ email, password });

    /*
     * Un solo mensaje para «no existe» y «contraseña mal», por lo mismo de
     * arriba: dos mensajes distintos dicen qué correos tienen cuenta.
     */
    redirect(error ? `${base}?error=1` : (String(formData.get('volver') ?? '') || `/${lang}`));
  }

  return (
    <div className="login">
      <h1>{t(idioma, 'signIn')}</h1>

      {sp.enviado ? (
        <p className="muted">{t(idioma, 'linkSent')}</p>
      ) : (
        <>
          {sp.error && <p className="aviso aviso-mal">{t(idioma, 'signInFailed')}</p>}

          <form action={conClave}>
            <input type="email" name="email" required placeholder="tu@correo.com" autoComplete="email" />
            <input
              type="password" name="password" required
              placeholder={t(idioma, 'password')} autoComplete="current-password"
            />
            <input type="hidden" name="volver" value={sp.volver ?? ''} />
            <button className="btn btn-primary" type="submit">{t(idioma, 'signIn')}</button>
          </form>

          <p className="muted small" style={{ padding: '18px 0 0' }}>{t(idioma, 'orByEmail')}</p>

          <form action={conEnlace}>
            <input type="email" name="email" required placeholder="tu@correo.com" autoComplete="email" />
            <button className="btn" type="submit">{t(idioma, 'sendLink')}</button>
          </form>

          <p className="muted small" style={{ paddingTop: 14 }}>
            {t(idioma, 'noAccountNote')}
          </p>

          <p className="small" style={{ paddingTop: 10 }}>
            <Link href={`/${idioma}`}>{t(idioma, 'backToMap')}</Link>
          </p>
        </>
      )}
    </div>
  );
}
