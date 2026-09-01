import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, formatNumber, type Lang } from '@/lib/i18n';
import { listArtists } from '@/lib/data';
import { path } from '@/lib/routes';

export const revalidate = 3600;

interface Props { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  return isLang(lang) ? { title: t(lang, 'topArtists') } : {};
}

/**
 * Los artistas con más obra en el catálogo.
 *
 * Existe porque a la ficha de un artista solo se llegaba desde la ficha de una
 * obra suya: había que dar con un cuadro de Goya para poder ver a Goya.
 *
 * Son doscientos de 21.619, y es una decisión y no un tope técnico: la cola son
 * artistas con una sola obra, cuyo nombre solo sirve si ya lo ibas buscando —y
 * para eso está el buscador, que se enlaza aquí abajo—. Paginar 217 páginas de
 * nombres que nadie recorre es fingir que se ofrece algo.
 */
export default async function Artistas({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const artistas = await listArtists(idioma);

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>{t(idioma, 'topArtists')}</h1>
        <p className="muted small">
          {t(idioma, 'restInSearch')}:{' '}
          <Link href={path(idioma, 'search')}>{t(idioma, 'searchAction')}</Link>
        </p>
      </header>

      <ul className="listado">
        {artistas.map((a) => (
          <li key={a.slug}>
            <Link href={path(idioma, 'artist', a.slug)}>{a.name}</Link>
            <span className="muted small">
              {a.birthYear ? ` · ${a.birthYear}${a.deathYear ? `–${a.deathYear}` : ''}` : ''}
              {' · '}{formatNumber(idioma, a.count)} {t(idioma, 'artworks')}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
