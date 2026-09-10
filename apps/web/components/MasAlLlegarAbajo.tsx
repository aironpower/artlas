'use client';

/**
 * Sigue trayendo obras al llegar al final, en vez de pedir un clic.
 *
 * **Envuelve a la `Paginacion` de siempre en vez de sustituirla**, y ahí está
 * lo que no se ve. La paginación va renderizada en el servidor, así que su
 * enlace a la página 2 está en el HTML: existe para quien no ejecuta
 * JavaScript y para quien indexa. Una lista infinita sin enlaces es una lista
 * cuya segunda página no existe para nadie de fuera, que es el motivo por el
 * que `Paginacion` usa enlaces de verdad y no botones.
 *
 * Se esconde solo cuando esto ha conseguido traer un lote. No hay parpadeo,
 * porque el enlace vive justo donde está el centinela: al final de la lista.
 * Quien no llega abajo no lo ve, y quien llega abajo ya está recibiendo obras.
 *
 * Se pide con antelación —`rootMargin` de 800 px— para que el lote llegue
 * antes de que se acabe la página y el scroll no dé un tirón.
 *
 * Lo que NO hace: crecer en silencio. Cada lote se anuncia en una región
 * `aria-live`, porque para quien navega con lector de pantalla una lista que
 * crece sin decirlo es una lista que no ha cambiado.
 */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { t, type Lang } from '@/lib/i18n';
import { masObrasDelMuseo } from '@/lib/museo-acciones';

interface Props {
  lang: Lang;
  slug: string;
  /** La primera que hay que pedir: la siguiente a la que se está viendo. */
  desdePagina: number;
  /** Camino del museo. Solo para rehacer el enlace si algo falla: `/p/N` detrás. */
  basePath: string;
  /** La `Paginacion` de siempre, pintada en el servidor. */
  children: ReactNode;
}

export default function MasAlLlegarAbajo({
  lang, slug, desdePagina, basePath, children,
}: Props) {
  const [trozos, setTrozos] = useState<ReactNode[]>([]);
  const [pagina, setPagina] = useState(desdePagina);
  const [hayMas, setHayMas] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);
  const centinela = useRef<HTMLDivElement | null>(null);

  /*
   * `pidiendo` es una ref y no un estado a propósito. El observador puede
   * dispararse dos veces antes de que React vuelva a pintar, y con un estado
   * las dos verían `cargando === false` y pedirían la misma página: la lista
   * saldría duplicada.
   */
  const pidiendo = useRef(false);

  const traer = useCallback(async () => {
    if (pidiendo.current || !hayMas) return;
    pidiendo.current = true;
    setCargando(true);
    setFallo(false);

    try {
      const lote = await masObrasDelMuseo(slug, lang, pagina);
      setTrozos((antes) => [...antes, lote.nodo]);
      setHayMas(lote.hayMas);
      setPagina((n) => n + 1);
    } catch {
      // Nadie se queda encerrado: se dice, y vuelve un enlace a la página que
      // no ha llegado, que se puede abrir por su URL como cualquier otra.
      setFallo(true);
      setHayMas(false);
    } finally {
      setCargando(false);
      pidiendo.current = false;
    }
  }, [slug, lang, pagina, hayMas]);

  useEffect(() => {
    const nodo = centinela.current;
    if (!nodo || !hayMas) return;

    /*
     * Sin IntersectionObserver —navegadores viejos— no se hace nada y la
     * paginación de siempre se queda. Degradar es volver a los botones, no
     * quedarse sin lista.
     */
    if (typeof IntersectionObserver === 'undefined') return;

    const observador = new IntersectionObserver(
      (entradas) => { if (entradas.some((e) => e.isIntersecting)) void traer(); },
      { rootMargin: '800px' },
    );

    observador.observe(nodo);
    return () => observador.disconnect();
  }, [traer, hayMas]);

  const yaHeTraidoAlgo = trozos.length > 0;

  return (
    <>
      {trozos.map((trozo, i) => <Fragment key={i}>{trozo}</Fragment>)}

      {/*
        * Todo lo que no es una tarjeta vive dentro de la misma rejilla, así que
        * ocupa la fila entera. Si no, el aviso y la paginación se colocarían
        * como si fueran una obra más y partirían la cuadrícula.
        */}
      <div ref={centinela} aria-hidden="true" style={{ gridColumn: '1 / -1' }} />

      <p className="muted small" role="status" aria-live="polite"
         style={{ padding: '14px 0', gridColumn: '1 / -1' }}>
        {cargando && t(lang, 'loadingMore')}
        {fallo && t(lang, 'loadMoreFailed')}
      </p>

      {/* La de siempre, hasta que esto demuestre que puede sustituirla. */}
      {!yaHeTraidoAlgo && !fallo && <div style={{ gridColumn: '1 / -1' }}>{children}</div>}

      {fallo && (
        <nav className="pagination" style={{ gridColumn: '1 / -1' }}>
          <span />
          <span />
          <Link className="pagination-link" href={`${basePath}/p/${pagina}`} rel="next">
            {t(lang, 'next')} →
          </Link>
        </nav>
      )}
    </>
  );
}
