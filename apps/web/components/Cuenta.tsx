'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { t, type Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';
import { useSesion } from '@/components/Sesion';
import { salir } from '@/lib/sesion-acciones';

/**
 * Lo de la cuenta en la barra de secciones: entrar, o tus favoritos y salir.
 *
 * **Era un componente de servidor y ese fue el agujero.** Leía la cookie de
 * sesión al pintarse, y como vive en el `layout`, esa lectura volvía dinámica
 * TODA página del sitio: el `revalidate = 3600` de las fichas de obra, artista
 * y museo no llegaba a aplicarse nunca. El comentario que había aquí decía que
 * el `<Suspense>` de alrededor acotaba lo dinámico a este componente, y no es
 * así: sin PPR, `Suspense` sirve para hacer streaming de un render dinámico, no
 * para salvar la caché de la ruta. El manifiesto del build lo enseñaba sin
 * discusión —`/[lang]/obra/[id]` no aparecía ni como estática ni como ISR—.
 *
 * Ahora pregunta desde el navegador, así que el HTML es idéntico para todo el
 * mundo y se puede guardar en el CDN.
 *
 * **Lo que se pierde, dicho claro:** sin JavaScript esta barra enseña siempre
 * «Entrar», aunque hayas entrado. No tiene arreglo dentro de una página
 * cacheada —el HTML es el mismo para todos por definición—, y el precio es
 * pequeño porque nada del catálogo exige cuenta: los favoritos, que sí, siguen
 * teniendo su página propia en `/favoritos`, que es dinámica y se pinta en el
 * servidor como siempre.
 */
export function Cuenta({ lang }: { lang: Lang }) {
  const sesion = useSesion();
  const router = useRouter();
  const [saliendo, transicion] = useTransition();

  // Mientras no se sabe, y cuando no hay nadie: el enlace de entrar. Es lo que
  // ve la mayoría, así que es también lo que menos parpadea.
  if (!sesion?.haySesion) {
    return <Link href={path(lang, 'login')}>{t(lang, 'signIn')}</Link>;
  }

  return (
    <>
      <Link href={path(lang, 'favorites')}>{t(lang, 'myFavorites')}</Link>
      {sesion.admin && <Link href={path(lang, 'admin')}>{t(lang, 'adminPanel')}</Link>}
      <button
        className="enlace"
        type="button"
        aria-busy={saliendo}
        onClick={() => transicion(async () => {
          await salir();
          /*
           * `refresh` además de la redirección de la acción: lo de la cuenta ya
           * no viaja en el HTML, así que sin esto la barra seguiría enseñando
           * «Salir» hasta la siguiente carga completa.
           */
          router.refresh();
        })}
      >
        {t(lang, 'signOut')}
      </button>
    </>
  );
}
