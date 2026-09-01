import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, type Lang } from '@/lib/i18n';
import { currentUser, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ hecho?: string; error?: string }>;
}

/**
 * Ponerse una contraseña, ya estando dentro.
 *
 * Existe para que nadie tenga que inventarle una contraseña a nadie ni
 * mandarla por ningún canal: se entra una vez por enlace al correo —que ya
 * demuestra que la cuenta es tuya— y desde aquí se pone la que uno quiera. A
 * partir de ahí se puede entrar directo, sin esperar un correo cada vez.
 *
 * El mínimo lo pone Supabase (6 caracteres); aquí se pide algo más largo porque
 * seis es una recomendación de 2010. No se comprueba «fuerza» con reglas de
 * mayúsculas y símbolos: producen contraseñas peores y apuntadas en un papel.
 */
export default async function Clave({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const sp = await searchParams;

  const usuario = await currentUser();
  if (!usuario) redirect(`${path(idioma, 'login')}?volver=${encodeURIComponent(`${path(idioma, 'login')}/clave`)}`);

  const base = `${path(idioma, 'login')}/clave`;

  async function guardar(formData: FormData) {
    'use server';

    const password = String(formData.get('password') ?? '');
    if (password.length < 10) redirect(`${base}?error=corta`);

    const db = await supabaseServer();
    const { error } = await db.auth.updateUser({ password });

    redirect(error ? `${base}?error=1` : `${base}?hecho=1`);
  }

  return (
    <div className="login">
      <h1>{t(idioma, 'setPassword')}</h1>
      <p className="muted small">{usuario.email}</p>

      {sp.hecho ? (
        <>
          <p className="aviso aviso-bien">{t(idioma, 'passwordSaved')}</p>
          <p className="small" style={{ paddingTop: 14 }}>
            <Link href={`/${idioma}`}>{t(idioma, 'backToMap')}</Link>
          </p>
        </>
      ) : (
        <>
          {sp.error === 'corta' && <p className="aviso aviso-mal">{t(idioma, 'passwordShort')}</p>}
          {sp.error === '1' && <p className="aviso aviso-mal">{t(idioma, 'passwordFailed')}</p>}

          <form action={guardar}>
            <input
              type="password" name="password" required minLength={10}
              placeholder={t(idioma, 'password')} autoComplete="new-password"
            />
            <button className="btn btn-primary" type="submit">{t(idioma, 'save')}</button>
          </form>

          <p className="muted small" style={{ paddingTop: 12 }}>{t(idioma, 'passwordHint')}</p>
        </>
      )}
    </div>
  );
}
