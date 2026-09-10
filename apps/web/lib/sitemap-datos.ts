import { supabase } from '@/lib/data';

/**
 * Lo que el sitemap necesita saber de la base, y en cuántos trozos parte.
 *
 * Vive aparte de `app/sitemap.ts` porque `app/robots.ts` necesita lo mismo:
 * tiene que anunciar cada trozo por su URL, y para eso hay que saber cuántos
 * hay. Con la cuenta calculada en dos sitios, el día que sobre un trozo el
 * robots anunciaría uno menos y nadie se enteraría.
 */

/**
 * **¿Van las obras al sitemap?** Hoy no, y es una decisión de dinero, no de
 * técnica.
 *
 * Publicadas hay 135.258, que por tres idiomas son ~405.000 URLs. Un sitemap
 * las ofrece TODAS de golpe, y el primer barrido de un buscador serían ~405.000
 * renders con su escritura de caché — más que las 200.000 que caben en el plan
 * gratuito de Vercel, que es justo lo que acaba de tumbar la web. Encendido
 * esto, la cifra hay que poder pagarla.
 *
 * Apagado NO se esconden: un rastreador llega a cada obra desde la ficha de su
 * artista y la de su museo, que es como debe descubrirlas y como reparte el
 * trabajo en el tiempo en vez de pedirlo todo el primer día.
 *
 * Se enciende poniendo esto en `true`. No hace falta tocar nada más: el número
 * de trozos y lo que anuncia el robots salen de aquí.
 */
export const OBRAS_EN_SITEMAP = false;

/**
 * URLs por fichero. El estándar admite 50.000 y aquí se dejan 45.000: el
 * esqueleto crece solo —cada artista nuevo son tres URLs— y un sitemap que se
 * pasa del tope no da error, lo ignora el buscador entero.
 */
const POR_TROZO = 45_000;

/** Cuántas filas trae Supabase de una vez. Es su tope por defecto. */
const POR_VIAJE = 1_000;

/**
 * Todos los slugs de una tabla del catálogo, en viajes de mil.
 *
 * `artwork_count > 0` en las tres: un artista sin obra publicada es una ficha
 * vacía, y ofrecérsela a un buscador es pedirle que rastree una página para
 * descubrir que no hay nada. Es el mismo filtro que usan las listas del sitio.
 */
export async function slugsDelCatalogo(
  tabla: 'artists' | 'institutions' | 'movements',
): Promise<string[]> {
  const slugs: string[] = [];

  for (let desde = 0; ; desde += POR_VIAJE) {
    const { data, error } = await supabase
      .from(tabla)
      .select('slug')
      .gt('artwork_count', 0)
      // Orden estable: sin él, dos viajes consecutivos pueden devolver la misma
      // fila y saltarse otra, y el sitemap saldría con huecos y repeticiones.
      .order('slug', { ascending: true })
      .range(desde, desde + POR_VIAJE - 1);

    if (error) throw new Error(`sitemap ${tabla}: ${error.message}`);

    slugs.push(...(data ?? []).map((f: { slug: string }) => f.slug));
    if (!data || data.length < POR_VIAJE) return slugs;
  }
}

/** Obras publicadas. Solo se pregunta si `OBRAS_EN_SITEMAP`. */
export async function contarObrasPublicadas(): Promise<number> {
  const { count, error } = await supabase
    .from('artworks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published');

  if (error) throw new Error(`sitemap obras (cuenta): ${error.message}`);
  return count ?? 0;
}

/** Un tramo de ids de obra publicada, ordenado. */
export async function idsDeObras(desde: number, cuantas: number): Promise<number[]> {
  const ids: number[] = [];

  for (let saltados = 0; saltados < cuantas; saltados += POR_VIAJE) {
    const primera = desde + saltados;
    const ultima = Math.min(primera + POR_VIAJE, desde + cuantas) - 1;

    const { data, error } = await supabase
      .from('artworks')
      .select('id')
      .eq('status', 'published')
      .order('id', { ascending: true })
      .range(primera, ultima);

    if (error) throw new Error(`sitemap obras: ${error.message}`);

    ids.push(...(data ?? []).map((f: { id: number }) => f.id));
    if (!data || data.length === 0) break;
  }

  return ids;
}

/**
 * Los trozos del sitemap, por su identificador.
 *
 * El 0 es siempre el esqueleto —portada, índices, museos, movimientos y
 * artistas en los tres idiomas—. Del 1 en adelante van las obras, y solo
 * existen con `OBRAS_EN_SITEMAP` encendido.
 */
export async function trozosDelSitemap(): Promise<number[]> {
  if (!OBRAS_EN_SITEMAP) return [0];

  const obras = await contarObrasPublicadas();
  // Cada obra son tres URLs, una por idioma, y las tres van juntas en el mismo
  // trozo: partir una obra entre dos ficheros no ahorra nada y complica el
  // tramo que hay que pedir.
  const porTrozo = Math.floor(POR_TROZO / 3);

  return [0, ...Array.from({ length: Math.ceil(obras / porTrozo) }, (_, i) => i + 1)];
}

/** El tramo de obras que le toca a un trozo. */
export function tramoDelTrozo(id: number): { desde: number; cuantas: number } {
  const porTrozo = Math.floor(POR_TROZO / 3);
  return { desde: (id - 1) * porTrozo, cuantas: porTrozo };
}
