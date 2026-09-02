import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, formatNumber } from '@/lib/i18n';
import { path } from '@/lib/routes';
import { mapPins, searchArtworks, countArtists } from '@/lib/data';
import ArtworkGrid from '@/components/ArtworkGrid';
import CercaDeAqui from '@/components/CercaDeAqui';

// El catálogo cambia solo cuando se reingiere. Una hora de caché evita pegarle
// a Supabase en cada visita sin que los datos se queden viejos de verdad.
export const revalidate = 3600;

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const [pins, highlights, artists] = await Promise.all([
    mapPins(lang),
    searchArtworks(lang, { limit: 12 }),
    countArtists(),
  ]);

  const totalWorks = pins.reduce((sum, p) => sum + p.artwork_count, 0);

  return (
    <>
      <section style={{ padding: '30px 0 18px' }}>
        <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)' }}>{t(lang, 'tagline')}</h1>
        {/*
          * Las tres cifras son enlaces desde el 1 de septiembre. Eran texto
          * plano, y eso dejaba los museos accesibles solo pulsando su chincheta
          * y los artistas solo desde la ficha de una obra suya. Un número que
          * dice «21.619 artistas» y no lleva a ninguna parte es una promesa que
          * la página no cumple.
          */}
        <p className="muted">
          <Link href={path(lang, 'search')}>
            {formatNumber(lang, totalWorks)} {t(lang, 'artworks')}
          </Link>{' · '}
          <Link href={path(lang, 'artists')}>
            {formatNumber(lang, artists)} {t(lang, 'artists')}
          </Link>{' · '}
          <Link href={path(lang, 'museums')}>
            {formatNumber(lang, pins.length)} {t(lang, 'museums')}
          </Link>
        </p>
      </section>

      {/*
        * El mapamundi y «cerca de mí» eran dos cosas separadas: un botón que
        * daba una lista y, debajo, un mapa que no se enteraba. Ahora es una:
        * el punto se elige con la posición, buscando un sitio o pinchando, y
        * el mismo mapa lo dibuja con el círculo del radio.
        */}
      <CercaDeAqui lang={lang} pins={pins} />

      <section style={{ paddingTop: 34 }}>
        <h2>{t(lang, 'explore')}</h2>
        <ArtworkGrid lang={lang} items={highlights} />
      </section>
    </>
  );
}
