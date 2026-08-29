'use client';

/**
 * Vuelve a pedir la página cada pocos segundos.
 *
 * No trae datos por su cuenta: llama a `router.refresh()`, que hace que Next
 * vuelva a ejecutar el componente de servidor. Así la consulta sigue haciéndose
 * con la sesión del administrador y sujeta a las políticas de la base — un
 * `fetch` desde el navegador habría necesitado una ruta de API nueva y una
 * segunda comprobación de rol que se puede olvidar.
 *
 * Solo late mientras hay algo corriendo. Refrescar una pantalla que ya no
 * cambia es gastar consultas del plan gratuito para volver a pintar lo mismo.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AutoRefresh({ activo, cada = 5000 }: { activo: boolean; cada?: number }) {
  const router = useRouter();
  const [ultimo, setUltimo] = useState<Date | null>(null);

  useEffect(() => {
    if (!activo) return;

    const id = setInterval(() => {
      router.refresh();
      setUltimo(new Date());
    }, cada);

    return () => clearInterval(id);
  }, [activo, cada, router]);

  if (!activo) return null;

  return (
    <p className="small muted" aria-live="off">
      Se actualiza sola cada {Math.round(cada / 1000)} s
      {ultimo && ` · última a las ${ultimo.toLocaleTimeString()}`}
    </p>
  );
}
