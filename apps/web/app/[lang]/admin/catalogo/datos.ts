import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lo que comparten las listas del catálogo.
 *
 * Los museos se traen ENTEROS y se agrupan en memoria. Con 48 filas eso es más
 * barato y mucho más simple que una función en la base por cada corte, y de
 * paso la lista de ciudades sale de los mismos datos que la de museos, así que
 * no pueden contradecirse. Cuando esto sean 500 museos seguirá cabiendo; si
 * algún día son 50.000, entonces sí tocará una vista agregada.
 */

export interface Museo {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  country: string | null;
  country_code: string | null;
  artwork_count: number;
  locked_fields: string[] | null;
  nombre_es?: string | null;
  ciudad_es?: string | null;
}

export interface Ciudad {
  ciudad: string;
  pais: string | null;
  codigo: string | null;
  museos: Museo[];
  obras: number;
}

/** Todos los museos, con su nombre y su ciudad en el idioma que se pide. */
export async function cargarMuseos(db: SupabaseClient, lang: string): Promise<Museo[]> {
  const { data } = await db
    .from('institutions')
    .select('id, name, slug, city, country, country_code, artwork_count, locked_fields,'
          + ' institution_translations ( lang, name, city )')
    .order('artwork_count', { ascending: false });

  /*
   * El cliente de Supabase no sabe tipar una consulta con relación anidada y la
   * da como error de cadena; el `unknown` de por medio es para decirle que aquí
   * mandamos nosotros, no para tapar un fallo.
   */
  const filas = (data ?? []) as unknown as Record<string, unknown>[];

  return filas.map((fila) => {
    const trads = (fila.institution_translations ?? []) as { lang: string; name: string; city: string | null }[];
    const mia = trads.find((t) => t.lang === lang);

    return {
      id: fila.id as number,
      name: fila.name as string,
      slug: fila.slug as string,
      city: fila.city as string | null,
      country: fila.country as string | null,
      country_code: fila.country_code as string | null,
      artwork_count: (fila.artwork_count as number) ?? 0,
      locked_fields: (fila.locked_fields as string[] | null) ?? [],
      nombre_es: mia?.name ?? null,
      ciudad_es: mia?.city ?? null,
    };
  });
}

/**
 * Los museos agrupados por ciudad.
 *
 * Se agrupa por la ciudad CANÓNICA y no por la traducida, por la misma razón
 * que el filtro público de 0032 filtra por ella: es el dato que no cambia al
 * cambiar de idioma. Si se agrupara por la traducción, la misma ciudad se
 * partiría en tres grupos distintos según quién mire.
 */
export function porCiudad(museos: Museo[]): Ciudad[] {
  const grupos = new Map<string, Ciudad>();

  for (const m of museos) {
    if (!m.city) continue;
    const clave = `${m.country_code ?? '??'}|${m.city}`;

    const grupo = grupos.get(clave) ?? {
      ciudad: m.city, pais: m.country, codigo: m.country_code, museos: [], obras: 0,
    };

    grupo.museos.push(m);
    grupo.obras += m.artwork_count;
    grupos.set(clave, grupo);
  }

  return [...grupos.values()].sort((a, b) => b.obras - a.obras);
}
