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
 * Conserva el resto de la consulta (`?q=goya&pais=es`) al cambiar de página.
 * Perderlos era el fallo obvio: pulsar "Siguiente" en una búsqueda filtrada te
 * devolvía la página 2 de TODO el catálogo.
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
  /** El resto de parámetros de la URL, que hay que conservar. */
  params?: Record<string, string | undefined>;
  /** Obras publicadas en total, cuando se sabe. */
  total?: number;
  pageSize: number;
}

export default function Paginacion({
  lang, page, hasNext, basePath, params = {}, total, pageSize,
}: Props) {
  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;

  if (page === 1 && !hasNext) return null;

  const href = (n: number) => {
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
