'use server';

import { supabaseServer } from '@/lib/auth';

/**
 * Salir de la cuenta.
 *
 * Vive en su propio fichero porque `Cuenta` pasó a ser un componente de
 * cliente y ya no puede definir la acción en línea, como hacía antes. Y es una
 * acción de servidor y no una llamada desde el navegador porque borrar la
 * sesión es escribir cookies: `supabaseServer` solo puede hacerlo aquí —en un
 * componente de servidor el `set` se traga el error a propósito, ver
 * `lib/auth.ts`—.
 *
 * No redirige. Antes sí, a la portada, y eso era perder el sitio: saliendo
 * desde la ficha del Guernica te devolvía al mapa del mundo. Quien llama hace
 * `router.refresh()` y se queda donde estaba; las páginas que de verdad exigen
 * cuenta —`/favoritos`, el panel— ya se defienden solas al repintarse.
 */
export async function salir() {
  const db = await supabaseServer();
  await db.auth.signOut();
}
