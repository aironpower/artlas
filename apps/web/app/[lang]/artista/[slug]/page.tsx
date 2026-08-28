import { notFound } from 'next/navigation';
import { isLang, t, formatNumber } from '@/lib/i18n';
import { getArtist, artworksByArtist } from '@/lib/data';
import ArtistMap from '@/components/ArtistMap';
import ArtworkGrid from '@/components/ArtworkGrid';

export const revalidate = 3600;

interface Props { params: Promise<{ lang: string; slug: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang, slug } = await params;
  if (!isLang(lang)) return {};

  const artist = await getArtist(lang, slug);
  if (!artist) return {};

  return {
    title: `${artist.name} · Artlas`,
    description: artist.description ?? undefined,
  };
}

export default async function ArtistPage({ params }: Props) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();

  const artist = await getArtist(lang, slug);
  if (!artist) notFound();

  const works = await artworksByArtist(lang, slug);

  // Museos distintos, no obras: es lo que el mapa puede enseñar como puntos
  // separados, porque las obras de un mismo museo comparten coordenadas.
  const museums = new Set(
    works.map((w) => w.institution_id).filter((id): id is number => id !== null),
  );

  const located = works.filter((w) => w.lat !== null && w.lng !== null);

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>{artist.name}</h1>
        <p className="muted">
          {(artist.birth_year || artist.death_year) && (
            <>{artist.birth_year ?? '?'}–{artist.death_year ?? '?'} · </>
          )}
          {formatNumber(lang, works.length)} {t(lang, 'artworks')}
          {museums.size > 0 && (
            <> · {formatNumber(lang, museums.size)} {t(lang, 'museums')}</>
          )}
        </p>
        {artist.description && <p className="muted">{artist.description}</p>}
      </header>

      {located.length > 0 && (
        <section style={{ paddingTop: 12 }}>
          <h2>{t(lang, 'whereToSee')}</h2>
          <ArtistMap works={located} lang={lang} />
          <p className="small muted" style={{ marginTop: 8 }}>{t(lang, 'sharedPointNote')}</p>
        </section>
      )}

      <section style={{ paddingTop: 28 }}>
        <h2>{t(lang, 'allWorksBy')} {artist.name}</h2>
        <ArtworkGrid lang={lang} items={works} />
      </section>
    </>
  );
}
