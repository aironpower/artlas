import { notFound, redirect } from 'next/navigation';
import { isLang, type Lang } from '@/lib/i18n';
import { currentUser, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

/**
 * Entrada al panel, por enlace mágico al correo.
 *
 * Sin contraseñas a propósito: no hay que almacenarlas, ni recuperarlas, ni
 * preocuparse de que alguien reutilice una. Para el puñado de personas que van
 * a revisar este catálogo, un correo con un enlace es suficiente y es menos
 * superficie de ataque.
 *
 * Recibir el enlace NO da permisos: crea el usuario y su fila en `profiles`
 * con rol `viewer`. A administrador se asciende con un UPDATE en la base.
 */
export default async function LoginPage({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  /* `lang` ya está validado, pero al capturarlo la acción de servidor pierde el
   * estrechamiento del tipo; se fija aquí para no repetir la comprobación. */
  const idioma: Lang = lang;

  const sp = await searchParams;

  // Si ya hay sesión, al panel: que decida `requireAdmin` si entra o no.
  if (await currentUser()) redirect(path(idioma, 'admin'));

  async function enviarEnlace(formData: FormData) {
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
     * Distinguir "correo enviado" de "ese correo no existe" convierte esta
     * pantalla en un comprobador de quién tiene cuenta.
     */
    redirect(`${path(idioma, 'admin')}/entrar?enviado=1`);
  }

  return (
    <div className="login">
      <h1>Panel de revisión</h1>

      {sp.enviado ? (
        <p className="muted">
          Si ese correo tiene cuenta, le llegará un enlace de acceso. Revisa la bandeja.
        </p>
      ) : (
        <>
          <p className="muted small">
            Acceso por enlace al correo. No hay contraseña que recordar ni que perder.
          </p>

          <form action={enviarEnlace}>
            <input
              type="email"
              name="email"
              required
              placeholder="tu@correo.com"
              autoComplete="email"
            />
            <button className="btn btn-primary" type="submit">Enviarme el enlace</button>
          </form>
        </>
      )}
    </div>
  );
}
