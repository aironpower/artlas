import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, type Lang } from '@/lib/i18n';
import { currentUser } from '@/lib/auth';
import { recuperar } from '@/lib/cuenta-acciones';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; enviado?: string }>;
}

/**
 * Pedir el enlace para poner una contraseña nueva.
 *
 * Aquí sí se disimula, y no es contradictorio con el resto: que este correo
 * tenga cuenta o no es información de la persona a la que pertenece, no de
 * quien rellena el formulario. Por eso el mensaje es el mismo en los dos
 * casos, y Supabase ayuda devolviendo éxito también para direcciones que no
 * existen.
 *
 * Lo que NO se disimula es que el correo no haya salido —límite de envíos,
 * SMTP caído—, porque eso no dice nada de nadie y sí explica por qué no llega
 * nada a la bandeja.
 *
 * El enlace lleva a `entrar/clave`, la misma pantalla que ya existía para
 * ponerse contraseña estando dentro. No hace falta una segunda: llegar por el
 * correo deja una sesión, así que se llega a ella igual que si hubieras
 * entrado, y una sola pantalla es una sola regla de longitud mínima.
 */
export default async function Recuperar({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const sp = await searchParams;

  // Con sesión abierta esto sobra: se cambia desde `entrar/clave`.
  if (await currentUser()) redirect(`${path(idioma, 'login')}/clave`);

  const base = path(idioma, 'login');

  return (
    <div className="login">
      <h1>{t(idioma, 'recoverTitle')}</h1>

      {sp.enviado ? (
        <>
          <p className="aviso aviso-bien">{t(idioma, 'linkSent')}</p>
          <p className="small" style={{ paddingTop: 14 }}>
            <Link href={base}>{t(idioma, 'signIn')}</Link>
          </p>
        </>
      ) : (
        <>
          <p className="muted small">{t(idioma, 'recoverIntro')}</p>

          {sp.error === 'correo' && <p className="aviso aviso-mal">{t(idioma, 'mailFailed')}</p>}
          {sp.error === 'direccion' && <p className="aviso aviso-mal">{t(idioma, 'emailInvalid')}</p>}
          {sp.error === '1' && <p className="aviso aviso-mal">{t(idioma, 'signUpFailed')}</p>}

          <form action={recuperar}>
            <input type="hidden" name="lang" value={idioma} />
            <input type="email" name="email" required placeholder="tu@correo.com" autoComplete="email" />
            <button className="btn btn-primary" type="submit">{t(idioma, 'sendLink')}</button>
          </form>

          <p className="small pie-cuenta">
            <Link href={base}>{t(idioma, 'signIn')}</Link>
          </p>
        </>
      )}
    </div>
  );
}
