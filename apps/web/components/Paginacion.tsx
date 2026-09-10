import Link from 'next/link';
import { t, formatNumber, type Lang } from '@/lib/i18n';

/**
 * Paginación de listas.
 *
 * Enlaces de verdad, no botones con JavaScript: la página queda en la URL, así
 * que se puede compartir, marcar como favorita, abrir en otra pestaña y —lo que
 * importa aquí— la indexan los buscadores. Una lista paginada con botones es
 * una lista cuya segunda página no existe para nadie de fuera.
 *
 * Hay dos formas de escribir la página en la URL, y no es una preferencia:
 *
 *   `modo="consulta"`  `/es/buscar?q=goya&p=2`   — la del buscador
 *   `modo="ruta"`      `/es/artista/goya/p/2`    — la de artista y museo
 *
 * La de ruta existe porque leer `searchParams` en una página del App Router la
 * vuelve dinámica, y eso descartaba el `revalidate = 3600` de las fichas de
 * artista y de museo: cada visita las renderizaba enteras contra la base. El
 * número de página en el camino llega por `params`, que no cuesta la caché.
 * El buscador se queda con la consulta porque ahí los filtros SON la página y
 * no tiene sentido cachearlo.
 *
 * En modo consulta conserva el resto de parámetros (`?q=goya&pais=es`) al
 * cambiar de página. Perderlos era el fallo obvio: pulsar "Siguiente" en una
 * búsqueda filtrada te devolvía la página 2 de TODO el catálogo.
 *
 * `total` es opcional porque no siempre se sabe. En un museo o un artista sí:
 * su `artwork_count` cuenta exactamente lo publicado, que es lo que la lista
 * enseña. En el buscador no, y contar las coincidencias de una búsqueda con
 * comodines en cada página se paga en el `statement_timeout` de 3 s del rol
 * `anon`. Sin total se enseña "Página 3" y se ofrece "Siguiente" solo si de
 * verdad hay algo detrás, que es lo que el visitante necesita saber.
 */
interface Props {
  lang: Lang;
  page: number;
  hasNext: boolean;
  /** Camino de la página, sin la consulta. Ej.: `/es/museo/museo-del-prado`. */
  basePath: string;
  /** El resto de parámetros de la URL, que hay que conservar. Solo en modo consulta. */
  params?: Record<string, string | undefined>;
  /** Dónde va el número de página. Ver la nota de arriba. */
  modo?: 'consulta' | 'ruta';
  /** Obras publicadas en total, cuando se sabe. */
  total?: number;
  pageSize: number;
}

export default function Paginacion({
  lang, page, hasNext, basePath, params = {}, modo = 'consulta', total, pageSize,
}: Props) {
  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;

  if (page === 1 && !hasNext) return null;

  const href = (n: number) => {
    // La página 1 es siempre el camino pelado, nunca `/p/1` ni `?p=1`: dos URLs
    // para la misma lista son dos páginas que indexar y dos entradas de caché.
    if (modo === 'ruta') return n > 1 ? `${basePath}/p/${n}` : basePath;

    const q = new URLSearchParams();
    for (const [clave, valor] of Object.entries(params)) {
      if (valor !== undefined && valor !== '' && clave !== 'p') q.set(clave, valor);
    }
    if (n > 1) q.set('p', String(n));
    const cadena = q.toString();
    return cadena ? `${basePath}?${cadena}` : basePath;
  };

  return (
    <nav className="pagination" aria-label={t(lang, 'page')}>
      {page > 1 ? (
        <Link className="pagination-link" href={href(page - 1)} rel="prev">
          ← {t(lang, 'previous')}
        </Link>
      ) : <span />}

      <span className="pagination-status muted small">
        {t(lang, 'page')} {formatNumber(lang, page)}
        {totalPages !== undefined && <> {t(lang, 'ofTotal')} {formatNumber(lang, totalPages)}</>}
      </span>

      {hasNext ? (
        <Link className="pagination-link" href={href(page + 1)} rel="next">
          {t(lang, 'next')} →
        </Link>
      ) : <span />}
    </nav>
  );
}

/**
 * Lee el número de página de la URL.
 *
 * Todo lo que no sea un entero positivo es la página 1: `?p=0`, `?p=-3`,
 * `?p=abc` y `?p=1e9` vienen de la barra de direcciones de cualquiera, y un
 * `offset` negativo o descomunal es un error de Postgres, no una página vacía.
 */
export function leerPagina(valor: string | undefined, maximo = 10_000): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, maximo);
}

/**
 * Lee el número de página de la RUTA, en las listas que la llevan ahí.
 *
 * Recibe lo que capta el segmento `[[...pagina]]`: `undefined` en
 * `/es/artista/goya`, `['p', '2']` en `/es/artista/goya/p/2`.
 *
 * Devuelve `null` —y quien llama hace `notFound()`— para todo lo que no sea
 * exactamente eso, incluido `/p/1`. Es deliberado y es lo que diferencia esto
 * de `leerPagina`: un parámetro de consulta raro se puede escribir solo, así
 * que `?p=abc` se perdona y se enseña la página 1; una ruta rara es una URL
 * inventada, y responderle con contenido crea páginas duplicadas que un
 * rastreador recorrerá una por una.
 */
export function paginaDeRuta(segmentos: string[] | undefined): number | null {
  if (!segmentos || segmentos.length === 0) return 1;
  if (segmentos.length !== 2 || segmentos[0] !== 'p') return null;

  const n = Number(segmentos[1]);
  if (!Number.isInteger(n) || n < 2 || n > 10_000) return null;

  return n;
}
