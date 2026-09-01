import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isLang, t, formatNumber, type Lang } from '@/lib/i18n';
import { currentUser, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import ArtworkGrid from '@/components/ArtworkGrid';
import { imageModeFor } from '@/lib/data';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  return isLang(lang) ? { title: t(lang, 'myFavorites') } : {};
}

/**
 * Las obras que alguien ha guardado.
 *
 * `force-dynamic` y no `revalidate`: es la única página del sitio cuyo
 * contenido depende de QUIÉN mira. Cachearla serviría los favoritos de uno a
 * otro, que es de los peores fallos que puede tener una web con cuentas.
 *
 * Sin sesión no da 404 sino que manda a entrar y vuelve aquí: la página existe
 * para todo el mundo, solo que hay que decir quién eres.
 */
export default async function Favoritos({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const destino = path(idioma, 'favorites');

  if (!(await currentUser())) {
    redirect(`${path(idioma, 'login')}?volver=${encodeURIComponent(destino)}`);
  }

  const db = await supabaseServer();
  const { data, error } = await db.rpc('my_favorites', { p_lang: idioma, p_limit: 200 });
  if (error) throw new Error(`favoritos: ${error.message}`);

  const obras = (data ?? []) as {
    id: number; title: string; slug: string; image_url: string | null;
    year_start: number | null; date_display: string | null;
    artist_name: string | null; artist_slug: string | null;
    institution_name: string | null; institution_slug: string | null;
    rights_status: string;
  }[];

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>{t(idioma, 'myFavorites')}</h1>
        <p className="muted small">
          {formatNumber(idioma, obras.length)} {t(idioma, 'artworks')}
        </p>
      </header>

      {obras.length === 0 ? (
        <p className="muted" style={{ padding: '20px 0 40px' }}>{t(idioma, 'noFavorites')}</p>
      ) : (
        <ArtworkGrid
          lang={idioma}
          items={obras.map((o) => ({
            id: o.id,
            title: o.title,
            image_url: o.image_url,
            year_start: o.year_start,
            date_display: o.date_display,
            artist_name: o.artist_name,
            institution_name: o.institution_name,
            /* Los derechos deciden si la imagen se enseña entera, en miniatura
             * o no se enseña; es la misma política que el buscador. */
            image_mode: imageModeFor(
              o.rights_status as 'public_domain' | 'in_copyright' | 'unknown',
              o.image_url,
              null,
            ),
          }))}
        />
      )}
    </>
  );
}
