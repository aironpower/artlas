'use client';

import { useOptimistic, useTransition } from 'react';
import Link from 'next/link';
import { t, type Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';

/**
 * Guardar una obra, o quitarla.
 *
 * Es de cliente y con estado optimista, y llegar aquí costó. Empezó siendo un
 * formulario de servidor puro —lo coherente con el resto de la app, donde nada
 * necesita JavaScript—, pero un interruptor por usuario no encaja en ese molde:
 * la respuesta de una acción de servidor se pinta reutilizando la carga que el
 * cliente ya tenía de esa página, así que el botón se quedaba enseñando el
 * estado anterior. La base guardaba bien y la pantalla mentía, que es peor que
 * no guardar. Ni `revalidatePath`, ni desactivar la caché del cliente de
 * Supabase, ni redirigir a la misma ruta lo arreglaron del todo: la redirección
 * lo dejaba bien unas veces y devolvía una página a medias otras.
 *
 * Con `useOptimistic` el estado lo lleva quien tiene que llevarlo —la pantalla,
 * al instante— y el servidor confirma después. Si la escritura falla, React
 * revierte solo al valor real.
 *
 * Sigue siendo un `<form>` con una acción de servidor de verdad, así que sin
 * JavaScript el botón continúa funcionando: se pierde la respuesta instantánea,
 * no la función.
 */
export function BotonFavorito(
  { lang, guardada, haySesion, ruta, accion }: {
    lang: Lang;
    guardada: boolean;
    haySesion: boolean;
    /** La ruta de esta página, para volver aquí tras entrar. */
    ruta: string;
    /** La acción de servidor, ya atada a esta obra. */
    accion: () => Promise<void>;
  },
) {
  const [optimista, marcar] = useOptimistic(guardada);
  const [enCurso, transicion] = useTransition();

  if (!haySesion) {
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
    <form
      action={() => transicion(async () => { marcar(!optimista); await accion(); })}
    >
      <button
        className={`btn favorito${optimista ? ' guardada' : ''}`}
        type="submit"
        aria-pressed={optimista}
        /* Se deja pulsable mientras vuela: el estado optimista ya refleja la
           intención y bloquearlo solo añadiría un parpadeo. `aria-busy` lo
           cuenta para quien no ve el botón. */
        aria-busy={enCurso}
      >
        {optimista ? '★' : '☆'} {t(lang, optimista ? 'inFavorites' : 'saveToFavorites')}
      </button>
    </form>
  );
}
