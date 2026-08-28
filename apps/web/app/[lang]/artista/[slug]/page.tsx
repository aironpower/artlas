import { notFound } from 'next/navigation';
import { isLang, t, formatNumber } from '@/lib/i18n';
import { getArtist, artworksByArtist } from '@/lib/data';
import { path } from '@/lib/routes';
import ArtistMap from '@/components/ArtistMap';
import ArtworkGrid from '@/components/ArtworkGrid';
import Paginacion, { leerPagina } from '@/components/Paginacion';

export const revalidate = 3600;

const POR_PAGINA = 36;

/*
 * El mapa sí necesita TODAS las obras, aunque la rejilla vaya paginada: enseña
 * en qué museos del mundo se reparten, y una página suelta daría un mapa
 * distinto en cada página. Se piden aparte y con tope, porque son puntos, no
 * tarjetas: pesan poco y no se pintan.
 */
const TOPE_MAPA = 500;

interface Props {
  params: Promise<{ lang: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

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

export default async function ArtistPage({ params, searchParams }: Props) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();

  const pagina = leerPagina((await searchParams).p);

  const artist = await getArtist(lang, slug);
  if (!artist) notFound();

  const [works, lote] = await Promise.all([
    artworksByArtist(lang, slug, TOPE_MAPA),
    artworksByArtist(lang, slug, POR_PAGINA + 1, (pagina - 1) * POR_PAGINA),
  ]);

  const enPagina = lote.slice(0, POR_PAGINA);

  /*
   * Una página más allá del final no es una página vacía: no existe. Se mira
   * lo que ha vuelto y no el contador, que se recalcula al terminar cada
   * ingesta y puede ir un rato por detrás de las filas.
   */
  if (pagina > 1 && lote.length === 0) notFound();


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
          {formatNumber(lang, artist.artwork_count)} {t(lang, 'artworks')}
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
        <ArtworkGrid lang={lang} items={enPagina} />
        <Paginacion
          lang={lang}
          page={pagina}
          hasNext={lote.length > POR_PAGINA}
          basePath={path(lang, 'artist', slug)}
          total={artist.artwork_count}
          pageSize={POR_PAGINA}
        />
      </section>
    </>
  );
}
