import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, formatNumber } from '@/lib/i18n';
import { path } from '@/lib/routes';
import { mapPins, searchArtworks, countArtists, BusquedaDemasiadoAncha } from '@/lib/data';
import ArtworkGrid from '@/components/ArtworkGrid';
import CercaDeAqui from '@/components/CercaDeAqui';

// El catálogo cambia solo cuando se reingiere. Una hora de caché evita pegarle
// a Supabase en cada visita sin que los datos se queden viejos de verdad.
export const revalidate = 3600;

/**
 * De dónde salen las doce obras de abajo.
 *
 * Eran siempre las mismas doce —las de más notabilidad— y una portada que
 * enseña lo mismo cada vez deja de proponer nada. Ahora se entra por un
 * desplazamiento al azar, así que cada vez que la página se regenera son otras.
 *
 * **El techo está medido, no elegido a ojo.** `search_artworks` sin consulta
 * ordena por notabilidad y pagina con `offset`, y el `offset` se paga: con la
 * clave `anon`, que es la que tiene el corte de 3 s,
 *
 *     offset      0 →   621 ms        offset  5.000 →  1.334 ms
 *     offset  1.000 →   234 ms        offset  8.000 →  1.054 ms
 *     offset  3.000 → 1.493 ms        offset 10.000 →  SE PASA DE 3 s
 *
 * Con 5.000 hay de sobra para que no se repitan y queda la mitad del
 * presupuesto libre. Y no es una limitación disfrazada de virtud: a partir de
 * ahí la notabilidad ya es 2 sobre 146, o sea la cola larga del catálogo.
 *
 * Cambian cada hora y no en cada visita, porque quien manda aquí es el
 * `revalidate` de arriba: hacerlas distintas por visitante sería volver
 * dinámica la portada entera y pagar una consulta por visita.
 */
const CUANTAS = 12;
const ALTURA_AZAR = 5_000;

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  /*
   * El azar cuesta, y por eso lleva red.
   *
   * `offset 0` es la consulta más barata que existe contra `search_artworks`;
   * entrar por un desplazamiento la encarece, y con el corte de 3 s del rol
   * `anon` eso significa que un día lento la portada —la portada— se caería con
   * «Application error». Vale la pena el azar; no vale la pena a ese precio.
   *
   * Así que si el azar no llega a tiempo se piden las de siempre, que sí
   * llegan. Solo se atrapa el corte por tiempo (`BusquedaDemasiadoAncha`):
   * cualquier otro error sigue subiendo, porque ese sí es un fallo nuestro y
   * esconderlo fue el error del 1 de septiembre en la pantalla de entrar.
   */
  const desde = Math.floor(Math.random() * ALTURA_AZAR);

  const [pins, azarosas, artists] = await Promise.all([
    mapPins(lang),
    searchArtworks(lang, { limit: CUANTAS, offset: desde }).catch((e) => {
      if (e instanceof BusquedaDemasiadoAncha) return [];
      throw e;
    }),
    countArtists(),
  ]);

  /*
   * La misma red cubre el otro caso: que detrás del desplazamiento no queden
   * doce obras. Hoy no puede pasar —hay 135.258 publicadas— pero un catálogo
   * más pequeño sí, y una portada con cuatro tarjetas es peor que una con las
   * de siempre.
   */
  const highlights = azarosas.length === CUANTAS
    ? azarosas
    : await searchArtworks(lang, { limit: CUANTAS }).catch((e) => {
        if (e instanceof BusquedaDemasiadoAncha) return [];
        throw e;
      });

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
        {/* «Al azar» se dice en el título a propósito: explica por qué no son
            las mismas que la última vez, en vez de dejarlo en un misterio. Y si
            no hay ninguna, no se pinta un título sobre un hueco. */}
        {highlights.length > 0 && (
          <>
            <h2>{t(lang, 'randomWorks')}</h2>
            <ArtworkGrid lang={lang} items={highlights} />
          </>
        )}
      </section>
    </>
  );
}
