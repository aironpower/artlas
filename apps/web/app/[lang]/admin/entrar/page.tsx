import { notFound, redirect } from 'next/navigation';
import { isLang } from '@/lib/i18n';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

/**
 * La entrada al panel se mudó a `/entrar`.
 *
 * Esta ruta se queda como redirección y no se borra porque está en enlaces
 * viejos, en el guion `ver-panel.mjs` y probablemente en algún marcador. Una
 * URL que alguien pudo guardar no se elimina, se reenvía.
 */
export default async function EntrarAdmin({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  redirect(`${path(lang, 'login')}?volver=${encodeURIComponent(path(lang, 'admin'))}`);
}
