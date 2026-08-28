import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, type Lang } from '@/lib/i18n';
import { getArtwork, artworksByArtist, artworksByInstitution } from '@/lib/data';
import { imageUrl } from '@/lib/images';
import { path } from '@/lib/routes';
import ArtworkGrid from '@/components/ArtworkGrid';
import ArtworkImage from '@/components/ArtworkImage';

export const revalidate = 3600;

/** Cuántas obras se enseñan en cada sección de "sigue por aquí". */
const RELACIONADAS = 12;

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

  /*
   * Por dónde seguir. Antes solo había "más obras del mismo autor", y eso
   * dejaba sin salida al 15% del catálogo: 9.336 obras publicadas no tienen
   * autor —Guernica, sin ir más lejos— y la sección sencillamente no se
   * pintaba. La ficha terminaba en blanco y el visitante, en un callejón.
   *
   * El museo, en cambio, lo tienen TODAS: cero obras publicadas sin museo. Por
   * eso va también, y en ese orden: el autor es lo más afín cuando existe, y el
   * museo es la red que nunca falla.
   *
   * Se pide una obra de más porque una de las que vuelven es esta misma, y hay
   * que quitarla sin dejar la fila coja.
   */
  const [alsoBy, alsoHere] = await Promise.all([
    work.artist
      ? artworksByArtist(lang, work.artist.slug, RELACIONADAS + 1)
      : Promise.resolve([]),
    work.institution
      ? artworksByInstitution(lang, work.institution.slug, RELACIONADAS + 1)
      : Promise.resolve([]),
  ]);

  const delAutor = alsoBy.filter((w) => w.id !== work.id).slice(0, RELACIONADAS);
  const delMuseo = alsoHere.filter((w) => w.id !== work.id).slice(0, RELACIONADAS);

  return (
    <>
      <article className="detail">
        <div>
          <ArtworkImage
            className="detail-image"
            mode={work.imageMode}
            imageUrl={work.imageUrl}
            thumbnailUrl={work.thumbnailUrl}
            originUrl={work.originUrl ?? work.institution?.website ?? null}
            title={work.title}
            width={1280}
            lang={lang}
          />
          {work.imageMode === 'full' && work.imageLicense && (
            <p className="small muted" style={{ marginTop: 8 }}>{work.imageLicense}</p>
          )}
        </div>

        <div>
          <h1>{work.title}</h1>

          {work.artist && (
            <p style={{ fontSize: '1.05rem', margin: '0 0 4px' }}>
              <Link href={path(lang, 'artist', work.artist.slug)}>
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
                  <Link href={`${path(lang, 'search')}?mov=${m.slug}`} className="chip">{m.name}</Link>
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
                  <Link href={path(lang, 'museum', work.institution.slug)}>
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

      {delAutor.length > 0 && work.artist && (
        <section>
          <div className="section-head">
            <h2>{t(lang, 'moreBy')} {work.artist.name}</h2>
            <Link className="small" href={path(lang, 'artist', work.artist.slug)}>
              {t(lang, 'seeAll')} →
            </Link>
          </div>
          <ArtworkGrid lang={lang as Lang} items={delAutor} />
        </section>
      )}

      {delMuseo.length > 0 && work.institution && (
        <section>
          <div className="section-head">
            <h2>{t(lang, 'moreAtMuseum')}</h2>
            <Link className="small" href={path(lang, 'museum', work.institution.slug)}>
              {t(lang, 'seeAll')} →
            </Link>
          </div>
          <ArtworkGrid lang={lang as Lang} items={delMuseo} />
        </section>
      )}
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <li><span className="k">{k}</span><span>{v}</span></li>;
}
