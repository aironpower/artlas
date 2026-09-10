'use client';

import { useEffect, useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { t, type Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';
import { useSesion } from '@/components/Sesion';
import { alternarFavorito } from '@/lib/favoritos-acciones';

/**
 * Guardar una obra, o quitarla.
 *
 * Con estado optimista, y llegar ahí costó. Empezó siendo un formulario de
 * servidor puro —lo coherente con el resto de la app, donde nada necesita
 * JavaScript—, pero un interruptor por usuario no encaja en ese molde: la
 * respuesta de una acción de servidor se pinta reutilizando la carga que el
 * cliente ya tenía de esa página, así que el botón se quedaba enseñando el
 * estado anterior. La base guardaba bien y la pantalla mentía, que es peor que
 * no guardar. Con `useOptimistic` el estado lo lleva quien tiene que llevarlo
 * —la pantalla, al instante— y el servidor confirma después.
 *
 * **Lo que cambió el 9 de septiembre de 2026:** si está guardada ya no llega
 * como propiedad desde el servidor, se pregunta desde aquí. La ficha de la obra
 * la pintaba consultando `esFavorita()` y `currentUser()`, y esas dos lecturas
 * de cookie descartaban el render estático de las 135.000 fichas del catálogo:
 * `revalidate = 3600` no llegaba a aplicarse nunca. Un corazón por persona no
 * cabe en un HTML que se guarda en la caché para todas.
 *
 * Solo se pregunta si hay sesión. Un visitante anónimo ve el enlace de entrar
 * sin que salga ni una petición: es el caso de casi todo el mundo, y de todo
 * rastreador.
 *
 * **Sin JavaScript ya no funciona**, y es el precio consciente de lo anterior:
 * la página cacheada no puede saber si esta obra es tuya. Se pierde el botón,
 * no la función — `/favoritos` sigue siendo una página de servidor.
 */
export function BotonFavorito(
  { lang, obraId, ruta }: {
    lang: Lang;
    obraId: number;
    /** La ruta de esta página, para volver aquí tras entrar. */
    ruta: string;
  },
) {
  const sesion = useSesion();
  const [guardada, setGuardada] = useState(false);
  const [optimista, marcar] = useOptimistic(guardada);
  const [enCurso, transicion] = useTransition();

  useEffect(() => {
    if (!sesion?.haySesion) return;

    const corte = new AbortController();

    fetch(`/api/favorito?obra=${obraId}`, { signal: corte.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((datos: { guardada: boolean } | null) => {
        if (datos) setGuardada(datos.guardada);
      })
      // Si no se sabe, se enseña sin guardar: pulsarlo la guarda, que es lo que
      // el visitante quería. Al revés —enseñarla guardada por si acaso— el
      // primer clic la borraría.
      .catch(() => {});

    return () => corte.abort();
  }, [sesion?.haySesion, obraId]);

  if (!sesion?.haySesion) {
    return (
      <Link
        className="btn favorito"
        href={`${path(lang, 'login')}?volver=${encodeURIComponent(ruta)}`}
      >
        ☆ {t(lang, 'saveToFavorites')}
      </Link>
    );
  }

  return (
    <button
      className={`btn favorito${optimista ? ' guardada' : ''}`}
      type="button"
      aria-pressed={optimista}
      /* Se deja pulsable mientras vuela: el estado optimista ya refleja la
         intención y bloquearlo solo añadiría un parpadeo. `aria-busy` lo
         cuenta para quien no ve el botón. */
      aria-busy={enCurso}
      onClick={() => transicion(async () => {
        const siguiente = !optimista;
        marcar(siguiente);
        const r = await alternarFavorito(obraId);
        // El valor real que confirma el servidor, no el que supusimos: si la
        // escritura falló, `useOptimistic` revierte al `guardada` de aquí.
        if (r.ok) setGuardada(r.guardado);
      })}
    >
      {optimista ? '★' : '☆'} {t(lang, optimista ? 'inFavorites' : 'saveToFavorites')}
    </button>
  );
}
