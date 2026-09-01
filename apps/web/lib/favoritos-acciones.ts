'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer, currentUser } from '@/lib/auth';

/**
 * Guardar y quitar favoritos. Aquí sí, `'use server'`: esto muta y lo invoca un
 * formulario. Lo que solo lee vive en `favoritos.ts`, que es un módulo normal.
 *
 * Escribe con la sesión del visitante y NO con la service_role, que es lo que
 * hace que la política de `favorites` decida: aunque llegara un `artworkId`
 * ajeno, la base solo deja escribir filas cuyo `user_id` sea `auth.uid()`. Por
 * eso el `user_id` tampoco viaja desde el formulario.
 */
export async function alternarFavorito(artworkId: number, ruta: string) {
  const usuario = await currentUser();
  if (!usuario) return { ok: false as const, razon: 'sin-sesion' as const };

  const db = await supabaseServer();

  const { data: yaEsta } = await db
    .from('favorites')
    .select('artwork_id')
    .eq('artwork_id', artworkId)
    .maybeSingle();

  /*
   * El error se mira, y no es formalidad.
   *
   * supabase-js no lanza: devuelve `{ error }` y sigue. Sin esta comprobación,
   * una escritura rechazada —por una política, por una clave— dejaría el botón
   * como estaba y la base vacía, sin una sola señal.
   */
  const { error } = yaEsta
    ? await db.from('favorites').delete().eq('artwork_id', artworkId)
    /*
     * `user_id` explícito porque la tabla no tiene valor por defecto, y
     * `ignoreDuplicates` para que un doble clic o un reenvío del navegador no
     * revienten contra la clave primaria: poner dos veces lo mismo es poner lo
     * mismo.
     */
    : await db
        .from('favorites')
        .upsert({ user_id: usuario.userId, artwork_id: artworkId }, { ignoreDuplicates: true });

  if (error) {
    console.error(`favoritos: ${error.message}`);
    return { ok: false as const, razon: 'error' as const };
  }

  revalidatePath(ruta);
  return { ok: true as const, guardado: !yaEsta };
}
