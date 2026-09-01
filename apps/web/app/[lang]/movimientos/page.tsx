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
 * La época de un movimiento, tal y como se lee en la tabla.
 *
 * Los años negativos son anteriores a Cristo y hay tres —la escultura griega
 * arcaica va del 699 al 479 a. C.—, así que enseñarlos crudos pondría «-699»
 * en pantalla. Cuando los dos extremos son a. C. basta un sufijo al final;
 * el arte romano, que va del 200 a. C. al 400, necesita el suyo en su sitio.
 *
 * Un movimiento con principio y sin final —el cubismo desde 1907— se queda con
 * la raya abierta, que es lo que significa.
 */
function epoca(idioma: Lang, inicio: number | null, fin: number | null): string {
  if (inicio === null && fin === null) return '—';

  const sufijo = t(idioma, 'bce');
  const anio = (y: number) => (y < 0 ? `${-y} ${sufijo}` : String(y));

  if (inicio !== null && fin !== null) {
    if (inicio < 0 && fin < 0) return `${-inicio}–${-fin} ${sufijo}`;
    return `${anio(inicio)}–${anio(fin)}`;
  }
  return inicio !== null ? `${anio(inicio)}–` : `–${anio(fin!)}`;
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

  const ordenados = [...movimientos].sort((a, b) => {
    if (orden === 'nombre') {
      return signo * a.name.localeCompare(b.name, idioma, { sensitivity: 'base' });
    }
    if (orden === 'epoca') {
      /*
       * Los 102 movimientos sin fecha van SIEMPRE al final, se ordene
       * ascendente o descendente. Invertirlos con el resto los pondría los
       * primeros al pulsar «descendente», y una lista que empieza con cien
       * guiones parece rota aunque esté bien ordenada.
       */
      if (a.startYear === null && b.startYear === null) return a.name.localeCompare(b.name, idioma);
      if (a.startYear === null) return 1;
      if (b.startYear === null) return -1;
      return signo * (a.startYear - b.startYear);
    }
    return signo * (a.count - b.count);
  });

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
                * La época existe desde el 1 de septiembre de 2026. Estuvo sin
                * columna a propósito mientras `start_year` y `end_year` eran
                * null en las 224 filas —una columna vacía parece un dato que
                * falta en vez de uno que no se trae—, y ahora la tienen 108.
                *
                * Los otros 102 salen con un guion y eso está bien: son
                * movimientos de cola y Wikidata no da su fecha por ninguna de
                * las cuatro propiedades. Entre los veinte con más obras, que
                * son los que se miran, quince la tienen.
                */}
              <Ordenable etiqueta={t(idioma, 'movement')} campo="nombre" orden={orden} dir={sentido} base={base} />
              <Ordenable etiqueta={t(idioma, 'colPeriod')} campo="epoca" orden={orden} dir={sentido} base={base} />
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
                <td className="muted">{epoca(idioma, m.startYear, m.endYear)}</td>
                <td className="num">{formatNumber(idioma, m.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
