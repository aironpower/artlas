import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, formatNumber, type Lang } from '@/lib/i18n';
import { mapPins } from '@/lib/data';
import { path } from '@/lib/routes';

export const revalidate = 3600;

interface Props { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  return isLang(lang) ? { title: t(lang, 'allMuseums') } : {};
}

/**
 * Los museos del catálogo, todos en una pantalla.
 *
 * Existe porque a la ficha de un museo solo se llegaba pulsando su chincheta en
 * el mapa o desde la ficha de una obra suya: si no sabías que el Prado estaba
 * dentro, no había forma de enterarse. Un mapa enseña dónde, pero no enseña
 * qué hay.
 *
 * Sin paginar y sin buscador propio: son 48. El día que sean 500 esto pedirá
 * agrupar por país, que es como se buscan los museos cuando son muchos.
 *
 * Se reutiliza `mapPins`, que ya trae nombre, ciudad, país y número de obras
 * traducidos y es la misma consulta que pinta la portada, así que la caché de
 * una hora sirve a las dos.
 */
export default async function Museos({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const museos = await mapPins(idioma);

  // Por número de obras: el que más tiene es por donde empieza a mirar
  // cualquiera, y ordenar por nombre pondría primero a un museo de 23 obras.
  const ordenados = [...museos].sort((a, b) => b.artwork_count - a.artwork_count);

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>{t(idioma, 'allMuseums')}</h1>
        <p className="muted small">
          {formatNumber(idioma, museos.length)} {t(idioma, 'museums')} ·{' '}
          {formatNumber(idioma, museos.reduce((n, m) => n + m.artwork_count, 0))}{' '}
          {t(idioma, 'artworks')}
        </p>
      </header>

      <ul className="listado">
        {ordenados.map((m) => (
          <li key={m.slug}>
            <Link href={path(idioma, 'museum', m.slug)}>{m.name}</Link>
            <span className="muted small">
              {m.city ? ` · ${m.city}` : ''}{m.country ? `, ${m.country}` : ''}
              {' · '}{formatNumber(idioma, m.artwork_count)} {t(idioma, 'artworks')}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
