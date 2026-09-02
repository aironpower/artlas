import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, formatNumber, formatYears, capitalize, type Lang } from '@/lib/i18n';
import { listArtists, listNationalities } from '@/lib/data';
import { path } from '@/lib/routes';
import { Ordenable } from '@/components/Ordenable';
import Paginacion from '@/components/Paginacion';

export const revalidate = 3600;

const POR_PAGINA = 60;

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    q?: string; orden?: string; dir?: string; p?: string;
    nat?: string; desde?: string; hasta?: string;
  }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  return isLang(lang) ? { title: t(lang, 'allArtists') } : {};
}

/**
 * Los artistas del catálogo: tabla ordenable y buscador propio.
 *
 * Existe por dos cosas que Manuel señaló el 1 de septiembre. Una, que a la
 * ficha de un artista solo se llegaba desde la ficha de una obra suya: había
 * que dar con un cuadro de Goya para poder ver a Goya. Y dos, que **el buscador
 * de la web busca obras, no artistas**: escribir «Goya» devolvía cuadros, no
 * al pintor.
 *
 * Son 11.426 con obra, así que aquí no vale enseñar los doscientos primeros y
 * mandar al resto a otro sitio: hay buscador, orden y páginas. Todo por la URL
 * —`?q=goya&orden=name&dir=asc`— para que un orden o una búsqueda se puedan
 * compartir y el botón de atrás deshaga.
 *
 * El trabajo lo hace `list_artists` (migración 0034) y no PostgREST porque el
 * nombre que se enseña es `coalesce(traducción, canónico)`: buscar «El Bosco»
 * tiene que encontrar al que la tabla llama «Hieronymus Bosch».
 */
export default async function Artistas({ params, searchParams }: Props) {
  const { lang } = await params;
  const { q, orden = 'works', dir = 'desc', p, nat, desde, hasta } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const pagina = Math.max(1, Number(p) || 1);
  const sentido = dir === 'asc' ? 'asc' : 'desc';
  const busqueda = q?.trim() ?? '';

  // Un año vacío o con letras no es «año 0»: es «no filtres por año».
  const año = (v: string | undefined) => {
    const n = Number(v);
    return v && Number.isFinite(n) ? Math.trunc(n) : undefined;
  };
  const desdeAño = año(desde);
  const hastaAño = año(hasta);

  /*
   * La lista blanca también aquí, y no solo en la base.
   *
   * `list_artists` ya ignora un `p_sort` que no conozca, pero dejar pasar lo
   * que venga de la URL haría que la cabecera se pintara como activa para un
   * orden que nadie está aplicando: la flecha diría una cosa y la tabla otra.
   */
  const ORDENES = ['name', 'nat', 'anios', 'works'] as const;
  const campo = (ORDENES as readonly string[]).includes(orden)
    ? (orden as (typeof ORDENES)[number])
    : 'works';

  const [{ artistas, total }, nacionalidades] = await Promise.all([
    listArtists(idioma, {
      q: busqueda,
      sort: campo,
      dir: sentido,
      limit: POR_PAGINA,
      offset: (pagina - 1) * POR_PAGINA,
      nat,
      desde: desdeAño,
      hasta: hastaAño,
    }),
    listNationalities(),
  ]);

  const base = path(idioma, 'artists');

  /*
   * Lo que sobrevive a un cambio de orden: los filtros sí, la página no. Al
   * reordenar se vuelve a la primera, que es lo que espera cualquiera; conservar
   * la página 7 de un orden distinto es enseñar un trozo del medio sin motivo.
   */
  const filtros = { q: busqueda, nat, desde, hasta };
  const extra = new URLSearchParams(
    Object.entries(filtros).filter(([, v]) => v) as [string, string][],
  ).toString();

  const hayFiltro = Boolean(busqueda || nat || desde || hasta);

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>{t(idioma, 'allArtists')}</h1>
        <p className="muted small">
          {formatNumber(idioma, total)} {t(idioma, 'artists')} · {t(idioma, 'sortHint')}
        </p>
      </header>

      {/* Formulario GET, como el del buscador de obras: sin JavaScript, y la
        * búsqueda queda en la URL. `orden` y `dir` viajan ocultos para no
        * perder la ordenación al buscar. */}
      <form className="buscador-lista" action={base}>
        <input
          type="search"
          name="q"
          defaultValue={busqueda}
          placeholder={t(idioma, 'searchArtists')}
          aria-label={t(idioma, 'searchArtists')}
        />

        {/* La nacionalidad va en un desplegable y no en texto libre porque sale
          * de Wikidata como etiqueta cerrada: escribir «Holanda» no encontraría
          * «Dutch Republic». Y con el recuento al lado, que es lo que dice si
          * merece la pena elegirla. */}
        <select name="nat" defaultValue={nat ?? ''} aria-label={t(idioma, 'colNationality')}>
          <option value="">{t(idioma, 'colNationality')}: —</option>
          {nacionalidades.map((n) => (
            /* La mayúscula es solo de la etiqueta: el `value` viaja a la
             * consulta y tiene que seguir siendo el texto exacto de Wikidata. */
            <option key={n.nationality} value={n.nationality}>
              {capitalize(n.nationality)} ({n.artists})
            </option>
          ))}
        </select>

        <input
          type="text" inputMode="numeric" name="desde" defaultValue={desde ?? ''}
          className="anio" placeholder={t(idioma, 'from')} aria-label={`${t(idioma, 'bornBetween')} · ${t(idioma, 'from')}`}
        />
        <input
          type="text" inputMode="numeric" name="hasta" defaultValue={hasta ?? ''}
          className="anio" placeholder={t(idioma, 'to')} aria-label={`${t(idioma, 'bornBetween')} · ${t(idioma, 'to')}`}
        />

        <input type="hidden" name="orden" value={campo} />
        <input type="hidden" name="dir" value={sentido} />
        <button className="btn btn-primary" type="submit">{t(idioma, 'searchAction')}</button>
        {hayFiltro && <Link className="btn" href={base}>{t(idioma, 'clear')}</Link>}
      </form>

      <p className="muted small" style={{ margin: '6px 0 0' }}>
        {t(idioma, 'bornBetween')} · {t(idioma, 'yearsHint')}
      </p>

      {artistas.length === 0 ? (
        <p className="aviso aviso-mal">{t(idioma, 'noArtists')}</p>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla">
            <thead>
              <tr>
                <Ordenable etiqueta={t(idioma, 'colArtist')} campo="name" orden={campo} dir={sentido} base={base} extra={extra} />
                <Ordenable etiqueta={t(idioma, 'colNationality')} campo="nat" orden={campo} dir={sentido} base={base} extra={extra} opcional />
                <Ordenable etiqueta={t(idioma, 'colYears')} campo="anios" orden={campo} dir={sentido} base={base} extra={extra} />
                <Ordenable etiqueta={t(idioma, 'colWorks')} campo="works" orden={campo} dir={sentido} base={base} extra={extra} />
              </tr>
            </thead>
            <tbody>
              {artistas.map((a) => (
                <tr key={a.slug}>
                  <td><Link href={path(idioma, 'artist', a.slug)}>{a.name}</Link></td>
                  <td className="muted col-opcional">
                    {a.nationality ? capitalize(a.nationality) : '—'}
                  </td>
                  <td className="muted">{formatYears(idioma, a.birthYear, a.deathYear) ?? '—'}</td>
                  <td className="num">{formatNumber(idioma, a.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Paginacion
        lang={idioma}
        page={pagina}
        hasNext={pagina * POR_PAGINA < total}
        basePath={base}
        params={{ ...filtros, orden: campo, dir: sentido }}
        total={total}
        pageSize={POR_PAGINA}
      />
    </>
  );
}
