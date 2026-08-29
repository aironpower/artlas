'use client';

import type { ReactNode } from 'react';

/**
 * Un desplegable que aplica el filtro al elegir, sin esperar al botón.
 *
 * Existe por un fallo concreto: el subfiltro de ciudad se llena con las
 * ciudades del país elegido, y el país solo se sabía al enviar el formulario.
 * Elegir «España» no hacía nada visible, así que el subfiltro parecía roto.
 *
 * Es una mejora progresiva y no un requisito: sin JavaScript el formulario
 * sigue siendo un GET normal con su botón, y todos los filtros siguen viviendo
 * en la URL. Esto solo se adelanta al botón cuando puede.
 */
export default function SelectQueEnvia(
  { children, ...resto }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode },
) {
  return (
    <select {...resto} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {children}
    </select>
  );
}
