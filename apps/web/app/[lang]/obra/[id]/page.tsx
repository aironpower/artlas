import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, type Lang } from '@/lib/i18n';
import { getArtwork, searchArtworks } from '@/lib/data';
import { imageUrl } from '@/lib/images';
import ArtworkGrid from '@/components/ArtworkGrid';

export const revalidate = 3600;

interface Props { params: Promise<{ lang: string; id: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang, id } = await params;
  if (!isLang(lang)) return {};

  const work = await getArtwork(lang, Number(id));
  if (!work) return {};

  return {
    title: `${work.title}${work.artist ? ` — ${work.artist.name}` : ''} · Artlas`,
    description: work.description ?? undefined,
    openGraph: { images: imageUrl(work.imageUrl, 1280) ? [imageUrl(work.imageUrl, 1280)!] : [] },
  };
}

export default async function ArtworkPage({ params }: Props) {
  const { lang, id } = await params;
  if (!isLang(lang)) notFound();

  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  const work = await getArtwork(lang, numericId);
  if (!work) notFound();

  // Más obras del mismo autor, para seguir tirando del hilo.
  const alsoBy = work.artist
    ? (await searchArtworks(lang, { artist: work.artist.slug, limit: 12 }))
        .filter((w) => w.id !== work.id)
    : [];

  return (
    <>
      <article className="detail">
        <div>
          {work.imageUrl && (
            <img
              className="detail-image"
              src={imageUrl(work.imageUrl, 1280) ?? ''}
              alt={work.title}
            />
          )}
          {work.imageLicense && (
            <p className="small muted" style={{ marginTop: 8 }}>{work.imageLicense}</p>
          )}
        </div>

        <div>
          <h1>{work.title}</h1>

          {work.artist && (
            <p style={{ fontSize: '1.05rem', margin: '0 0 4px' }}>
              <Link href={`/${lang}/buscar?artista=${work.artist.slug}`}>
                {work.artist.name}
              </Link>
              {work.artist.birthYear && (
                <span className="muted small">
                  {' '}({work.artist.birthYear}–{work.artist.deathYear ?? '?'})
                </span>
              )}
            </p>
          )}

          {work.description && <p className="muted">{work.description}</p>}

          {work.movements.length > 0 && (
            <ul className="chips">
              {work.movements.map((m: { id: number; slug: string; name: string }) => (
                <li key={m.id}>
                  <Link href={`/${lang}/buscar?mov=${m.slug}`} className="chip">{m.name}</Link>
                </li>
              ))}
            </ul>
          )}

          <ul className="facts">
            {work.dateDisplay && <Fact k={t(lang, 'date')} v={work.dateDisplay} />}
            {work.medium && <Fact k={t(lang, 'technique')} v={work.medium} />}
            {work.genre && <Fact k={t(lang, 'genre')} v={work.genre} />}
            {work.heightCm && work.widthCm && (
              <Fact k={t(lang, 'dimensions')} v={`${work.heightCm} × ${work.widthCm} cm`} />
            )}
            {work.institution && (
              <li>
                <span className="k">{t(lang, 'inMuseum')}</span>
                <span>
                  <Link href={`/${lang}/museo/${work.institution.slug}`}>
                    {work.institution.name}
                  </Link>
                  <br />
                  <span className="muted small">
                    {[work.institution.city, work.institution.country].filter(Boolean).join(', ')}
                  </span>
                </span>
              </li>
            )}
          </ul>

          {work.sourceUrl && (
            <p className="small muted" style={{ marginTop: 18 }}>
              <a href={work.sourceUrl} target="_blank" rel="noopener noreferrer">Wikidata ↗</a>
            </p>
          )}
        </div>
      </article>

      {alsoBy.length > 0 && work.artist && (
        <section>
          <h2>{t(lang, 'allWorksBy')} {work.artist.name}</h2>
          <ArtworkGrid lang={lang as Lang} items={alsoBy} />
        </section>
      )}
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <li><span className="k">{k}</span><span>{v}</span></li>;
}
