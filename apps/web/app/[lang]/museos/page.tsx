import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, formatNumber, type Lang } from '@/lib/i18n';
import { mapPins } from '@/lib/data';
import { path } from '@/lib/routes';
import { Ordenable } from '@/components/Ordenable';

export const revalidate = 3600;

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ orden?: string; dir?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  return isLang(lang) ? { title: t(lang, 'allMuseums') } : {};
}

/**
 * Los museos del catálogo, en una tabla que se ordena.
 *
 * Existe porque a la ficha de un museo solo se llegaba pulsando su chincheta en
 * el mapa o desde la ficha de una obra suya: si no sabías que el Prado estaba
 * dentro, no había forma de enterarse. Un mapa enseña dónde, pero no enseña
 * qué hay ni cuánto.
 *
 * Se ordena desde la URL y no con JavaScript: `?orden=ciudad&dir=asc` se puede
 * compartir y el botón de atrás deshace. Y se ordena aquí, en memoria, porque
 * son 48 y ya están todos pedidos: bajar a la base a reordenar 48 filas que ya
 * tienes en la mano es pagar una ida y vuelta por nada.
 *
 * Reutiliza `mapPins`, la misma consulta que pinta el mapa de la portada, así
 * que las dos páginas comparten la caché de una hora.
 */
export default async function Museos({ params, searchParams }: Props) {
  const { lang } = await params;
  const { orden = 'obras', dir = 'desc' } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const museos = await mapPins(idioma);

  const sentido = dir === 'asc' ? 'asc' : 'desc';
  const signo = sentido === 'asc' ? 1 : -1;

  // `localeCompare` con el idioma de la página: en español la Ñ va tras la N y
  // los acentos no cuentan, cosa que un `<` sobre cadenas no sabe.
  const texto = (a: string | null, b: string | null) =>
    (a ?? '').localeCompare(b ?? '', idioma, { sensitivity: 'base' });

  const ordenados = [...museos].sort((a, b) => {
    switch (orden) {
      case 'museo':  return signo * texto(a.name, b.name);
      case 'ciudad': return signo * texto(a.city, b.city);
      case 'pais':   return signo * texto(a.country, b.country);
      default:       return signo * (a.artwork_count - b.artwork_count);
    }
  });

  const base = path(idioma, 'museums');

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>{t(idioma, 'allMuseums')}</h1>
        <p className="muted small">
          {formatNumber(idioma, museos.length)} {t(idioma, 'museums')} ·{' '}
          {formatNumber(idioma, museos.reduce((n, m) => n + m.artwork_count, 0))}{' '}
          {t(idioma, 'artworks')} · {t(idioma, 'sortHint')}
        </p>
      </header>

      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <Ordenable etiqueta={t(idioma, 'colMuseum')} campo="museo" orden={orden} dir={sentido} base={base} />
              <Ordenable etiqueta={t(idioma, 'city')} campo="ciudad" orden={orden} dir={sentido} base={base} />
              <Ordenable etiqueta={t(idioma, 'country')} campo="pais" orden={orden} dir={sentido} base={base} opcional />
              <Ordenable etiqueta={t(idioma, 'colWorks')} campo="obras" orden={orden} dir={sentido} base={base} />
            </tr>
          </thead>
          <tbody>
            {ordenados.map((m) => (
              <tr key={m.slug}>
                <td><Link href={path(idioma, 'museum', m.slug)}>{m.name}</Link></td>
                <td className="muted">{m.city ?? '—'}</td>
                <td className="muted col-opcional">{m.country ?? "—"}</td>
                <td className="num">{formatNumber(idioma, m.artwork_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
