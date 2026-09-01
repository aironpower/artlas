import { supabaseServer, currentUser } from '@/lib/auth';

/**
 * Leer favoritos. **Sin `'use server'` a propósito.**
 *
 * Estaba en el mismo fichero que la acción de guardar, y ese fichero lleva
 * `'use server'` en la primera línea: eso convierte en acción de servidor a
 * TODO lo que exporta, incluida una función que solo lee. La página la llamaba
 * al pintarse, y el resultado era que tras guardar el botón seguía diciendo
 * «Guardar» —la base bien, la pantalla un paso por detrás—.
 *
 * La regla que queda: `'use server'` marca lo que MUTA y se invoca desde un
 * formulario. Lo que se lee al renderizar es un módulo normal.
 */
export async function esFavorita(artworkId: number): Promise<boolean> {
  if (!(await currentUser())) return false;

  const db = await supabaseServer();
  const { data } = await db
    .from('favorites')
    .select('artwork_id')
    .eq('artwork_id', artworkId)
    .maybeSingle();

  return Boolean(data);
}
