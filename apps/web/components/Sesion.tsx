'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Sesion } from '@/app/api/sesion/route';

/**
 * Quién mira, preguntado UNA vez por carga de página.
 *
 * Va en un contexto y no en un hook suelto porque en la ficha de una obra hay
 * dos cosas que necesitan la respuesta —la barra de cuenta y el botón de
 * favorito— y con un hook suelto cada una haría su propia petición. La caché
 * del navegador no las uniría: `/api/sesion` se sirve `no-store` a propósito.
 *
 * El estado empieza en `null` y no en «no hay sesión»: son cosas distintas.
 * `null` es «todavía no lo sé», y quien lo consume tiene que pintar algo que
 * no mienta mientras tanto —el enlace de entrar, que es lo que ve la inmensa
 * mayoría— en vez de un hueco que dé un salto al llegar la respuesta.
 */
const Contexto = createContext<Sesion | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(null);

  useEffect(() => {
    /*
     * `AbortController` porque en una navegación rápida —pulsar un cuadro y
     * volver atrás antes de que responda— la petición vieja llegaría después
     * de la nueva y pintaría el estado de la página anterior.
     */
    const corte = new AbortController();

    fetch('/api/sesion', { signal: corte.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((datos: Sesion | null) => { if (datos) setSesion(datos); })
      /*
       * Un fallo aquí no rompe nada: se queda en `null` y el sitio se ve como
       * lo ve quien no ha entrado. Es exactamente lo que hay que enseñar
       * cuando no se sabe quién mira.
       */
      .catch(() => {});

    return () => corte.abort();
  }, []);

  return <Contexto.Provider value={sesion}>{children}</Contexto.Provider>;
}

/** La sesión, o `null` mientras no se sepa. */
export function useSesion(): Sesion | null {
  return useContext(Contexto);
}
