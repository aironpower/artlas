import { notFound } from 'next/navigation';
import { isLang, t, formatNumber } from '@/lib/i18n';
import { mapPins, searchArtworks } from '@/lib/data';
import WorldMap from '@/components/WorldMap';
import ArtworkGrid from '@/components/ArtworkGrid';
import NearMe from '@/components/NearMe';

// El catálogo cambia solo cuando se reingiere. Una hora de caché evita pegarle
// a Supabase en cada visita sin que los datos se queden viejos de verdad.
export const revalidate = 3600;

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const [pins, highlights] = await Promise.all([
    mapPins(lang),
    searchArtworks(lang, { limit: 12 }),
  ]);

  const totalWorks = pins.reduce((sum, p) => sum + p.artwork_count, 0);

  return (
    <>
      <section style={{ padding: '30px 0 18px' }}>
        <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>{t(lang, 'tagline')}</h1>
        <p className="muted">
          {formatNumber(lang, totalWorks)} {t(lang, 'artworks')} ·{' '}
          {formatNumber(lang, pins.length)} {t(lang, 'museums')}
        </p>
      </section>

      <NearMe lang={lang} />

      <WorldMap pins={pins} lang={lang} />

      <section style={{ paddingTop: 34 }}>
        <h2>{t(lang, 'explore')}</h2>
        <ArtworkGrid lang={lang} items={highlights} />
      </section>
    </>
  );
}
