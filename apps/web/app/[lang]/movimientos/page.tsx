import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, formatNumber, type Lang } from '@/lib/i18n';
import { listAllMovements } from '@/lib/data';
import { path } from '@/lib/routes';
import { Ordenable } from '@/components/Ordenable';

export const revalidate = 3600;

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ orden?: string; dir?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  return isLang(lang) ? { title: t(lang, 'allMovements') } : {};
}

/**
 * Los movimientos del catálogo, en una tabla que se ordena.
 *
 * Eran el único eje del catálogo sin página propia: se podía filtrar por
 * movimiento en el buscador, pero solo eligiendo de un desplegable de cuarenta,
 * así que los otros 147 no existían para nadie.
 *
 * Cada fila lleva al buscador ya filtrado y no a una ficha de movimiento,
 * porque una ficha de movimiento sería el buscador filtrado con otro nombre. Lo
 * que alguien quiere al pulsar «Impresionismo» son las obras.
 *
 * Se ordena en memoria: son 187 y ya están todos pedidos.
 */
export default async function Movimientos({ params, searchParams }: Props) {
  const { lang } = await params;
  const { orden = 'obras', dir = 'desc' } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  const movimientos = await listAllMovements(idioma);

  const sentido = dir === 'asc' ? 'asc' : 'desc';
  const signo = sentido === 'asc' ? 1 : -1;

  const ordenados = [...movimientos].sort((a, b) => (
    orden === 'nombre'
      ? signo * a.name.localeCompare(b.name, idioma, { sensitivity: 'base' })
      : signo * (a.count - b.count)
  ));

  const base = path(idioma, 'movements');

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>{t(idioma, 'allMovements')}</h1>
        <p className="muted small">
          {formatNumber(idioma, movimientos.length)} {t(idioma, 'movements')} ·{' '}
          {t(idioma, 'sortHint')}
        </p>
      </header>

      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              {/*
                * Sin columna de época, y no por olvido: `movements` tiene
                * `start_year` y `end_year` y están a null en los 187. La
                * ingesta nunca los pidió a Wikidata. Una columna vacía en una
                * tabla es peor que no tenerla, porque parece un dato que falta
                * en vez de un dato que no se trae.
                */}
              <Ordenable etiqueta={t(idioma, 'movement')} campo="nombre" orden={orden} dir={sentido} base={base} />
              <Ordenable etiqueta={t(idioma, 'colWorks')} campo="obras" orden={orden} dir={sentido} base={base} />
            </tr>
          </thead>
          <tbody>
            {ordenados.map((m) => (
              <tr key={m.slug}>
                <td>
                  <Link href={`${path(idioma, 'search')}?mov=${encodeURIComponent(m.slug)}`}>
                    {m.name}
                  </Link>
                </td>
                <td className="num">{formatNumber(idioma, m.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
