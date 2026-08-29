import type { ReactNode } from 'react';

/**
 * La entrada del contenido al cambiar de vista.
 *
 * Es un `template.tsx` y no parte del `layout.tsx` por una razón concreta: un
 * layout se conserva entre navegaciones y un template se vuelve a montar en
 * cada una. Esa diferencia ES la animación — sin ella habría que detectar el
 * cambio de ruta con JavaScript y disparar algo a mano.
 *
 * Con los esqueletos, la secuencia completa queda: pulsar, esqueleto con la
 * forma de lo que viene, y el contenido entrando encima. Antes de hoy esa
 * secuencia era: pulsar, nada, y todo de golpe.
 *
 * Por qué no la API de View Transitions, que es lo que se pediría por su
 * nombre: en Next hoy es experimental y arrastra React experimental. Meter eso
 * en algo ya desplegado, para ganar un cruce de imágenes, es mal negocio. Esto
 * son ocho líneas de CSS y no puede romper nada.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="entrada">{children}</div>;
}
