'use client';

import type { ReactNode } from 'react';
import { useSesion } from '@/components/Sesion';

/**
 * Enseña lo de dentro solo a quien administra.
 *
 * En el navegador y no en el servidor, por lo mismo que `Cuenta`: preguntarlo
 * al pintar volvía dinámica la página entera. Aquí el motivo se nota más,
 * porque el enlace de corregir sale en la ficha de una obra —135.000 páginas—
 * y lo ve una sola persona.
 *
 * Los hijos vienen ya pintados desde el servidor: esto solo decide si se
 * cuelgan del árbol, así que no hace falta duplicar en cliente los enlaces ni
 * las traducciones.
 *
 * **Esto es apariencia, no permiso**, igual que `viewerIsAdmin`. Que el enlace
 * viaje en el JavaScript de todo el mundo no abre nada: quien fuerce la URL del
 * formulario de corrección se topa con `requireAdmin`, y quien llame a la base,
 * con las políticas.
 */
export function SoloAdmin({ children }: { children: ReactNode }) {
  return useSesion()?.admin ? <>{children}</> : null;
}
