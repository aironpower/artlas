import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  isLang, t, formatNumber, formatYears, countryName, historicalState, type Lang,
} from '@/lib/i18n';
import { getArtist, artworksByArtist, relatedArtists, type RelatedArtist } from '@/lib/data';
import { path } from '@/lib/routes';
import ArtistMap from '@/components/ArtistMap';
import ArtworkGrid from '@/components/ArtworkGrid';
import Paginacion, { paginaDeRuta } from '@/components/Paginacion';

/*
 * Un día, no una hora.
 *
 * Con `revalidate = 3600` cada página que un rastreador vuelve a pisar pasada
 * la hora se regenera, y son 34.000 páginas: eso es render por página y hora,
 * pagado, para un catálogo que **solo cambia cuando se lanza una ingesta**. A
 * 24 horas las regeneraciones se dividen entre 24 y no se pierde nada, porque
 * entre ingesta e ingesta pasan días.
 *
 * **Cómo se purga cuando sí cambia:** desplegando. Cada despliegue estrena
 * caché, así que el `git push` que sigue a una ingesta ya deja el catálogo al
 * día. Si algún día la ingesta corre sin desplegar detrás —cuando se mude al
 * VPS—, hará falta que avise ella, con `revalidatePath` desde una ruta propia.
 *
 * La portada NO sube: enseña doce obras al azar y a un día se quedaría quieta.
 */
export const revalidate = 86_400;

/**
 * Vacío a propósito, y hace falta que exista.
 *
 * Sin `generateStaticParams` una ruta con segmento dinámico no es ISR: Next la
 * marca «server-rendered on demand» y la renderiza ENTERA en cada visita,
 * aunque tenga `revalidate`. Devolviendo la lista vacía no se prerenderiza nada
 * al construir —serían 34.000 páginas y un build de horas— pero la ruta pasa a
 * cachearse bajo demanda: la primera visita la genera y la guarda, y las
 * siguientes la reciben del CDN hasta que caduque la hora.
 *
 * Se comprueba en `.next/prerender-manifest.json`: la ruta tiene que aparecer
 * en `dynamicRoutes`. Si no está, no se está cacheando.
 */
export function generateStaticParams() {
  return [];
}

const POR_PAGINA = 36;

/*
 * El mapa sí necesita TODAS las obras, aunque la rejilla vaya paginada: enseña
 * en qué museos del mundo se reparten, y una página suelta daría un mapa
 * distinto en cada página. Se piden aparte y con tope, porque son puntos, no
 * tarjetas: pesan poco y no se pintan.
 */
const TOPE_MAPA = 500;

/*
 * La página va en la RUTA —`/es/artista/goya/p/2`— y no en `?p=2`, y no es
 * cosmética. Leer `searchParams` vuelve dinámica la página en el App Router, y
 * eso descartaba el `revalidate = 3600` de arriba: las 11.426 fichas de artista
 * se renderizaban enteras, con su mapa y sus relacionados, en cada visita. Por
 * `params` llega gratis. Las URLs viejas con `?p=` las redirige
 * `next.config.ts`, así que ningún enlace compartido se rompe.
 */
interface Props {
  params: Promise<{ lang: string; slug: string; pagina?: string[] }>;
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

export default async function ArtistPage({ params }: Props) {
  const { lang, slug, pagina: segmentos } = await params;
  if (!isLang(lang)) notFound();

  const pagina = paginaDeRuta(segmentos);
  if (pagina === null) notFound();

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
  /*
   * Los relacionados se piden aquí y no dentro de la sección porque van en el
   * mismo viaje: es una consulta de 60-900 ms y bloquearía el renderizado si
   * esperara a que termine lo de arriba.
   */
  const relacionados = await relatedArtists(lang, slug);

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
          {/*
            * El país de origen, y se pincha.
            *
            * La ficha lo tenía en los datos y no lo enseñaba, así que la única
            * manera de saber de dónde era un pintor era volver a la lista de
            * artistas y buscarlo. Enlaza a esa lista ya filtrada, que es la
            * pregunta que uno se hace al leerlo: «¿y quién más de ahí?».
            *
            * En la URL viaja el texto EXACTO de Wikidata, que es contra lo que
            * compara el filtro; lo traducido es solo lo que se lee.
            */}
          {artist.nationality && (
            <> · <Link
              href={`${path(lang, 'artists')}?nat=${
                encodeURIComponent(artist.nationality_code ?? artist.nationality)}`}
              title={historicalState(artist.nationality_code, artist.nationality)}
            >{countryName(lang, artist.nationality_code, artist.nationality)}</Link></>
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
          modo="ruta"
          total={artist.artwork_count}
          pageSize={POR_PAGINA}
        />
      </section>

      {/*
        * Solo en la primera página. En la cuarta página de obras de Rembrandt,
        * quien está mirando ya sabe a quién quiere ver; los relacionados son
        * una puerta de salida, y las puertas van donde se entra.
        */}
      {pagina === 1 && relacionados.length > 0 && (
        <section style={{ paddingTop: 28 }}>
          <h2>{t(lang, 'relatedArtists')}</h2>
          <ul className="relacionados">
            {relacionados.map((r) => (
              <li key={r.slug}>
                <Link href={path(lang, 'artist', r.slug)}>{r.name}</Link>
                <span className="muted small">
                  {formatYears(lang, r.birth_year, r.death_year) ?? ''}
                  {' · '}
                  {formatNumber(lang, r.artwork_count)} {t(lang, 'artworks')}
                </span>
                <span className="muted small">{porQue(lang, r)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Por qué está ahí ese artista.
 *
 * Una lista de sugeridos que no dice de dónde sale es una caja negra, y en este
 * proyecto las cajas negras se abren — es la misma regla que hizo que la ingesta
 * tenga panel en vez de un log.
 *
 * En sustantivos sueltos —«en común: país · movimiento»— y no en frases. Con
 * «mismo país · mismo movimiento · misma época · mismo museo» cada tarjeta se
 * comía tres líneas repitiendo «mismo», y como los primeros coinciden en las
 * cuatro cosas, ocho tarjetas decían ocho veces lo mismo a lo largo y ancho.
 *
 * El orden es el de los pesos de la consulta: primero lo que relaciona —país y
 * movimiento—, luego lo que solo desempata.
 */
function porQue(lang: Lang, r: RelatedArtist): string {
  const motivos = [
    r.same_country && t(lang, 'sameCountry'),
    r.same_movement && t(lang, 'sameMovement'),
    r.same_period && t(lang, 'samePeriod'),
    r.same_museum && t(lang, 'sameMuseum'),
  ].filter((m): m is string => typeof m === 'string');

  return motivos.length > 0 ? `${t(lang, 'inCommon')}: ${motivos.join(' · ')}` : '';
}
