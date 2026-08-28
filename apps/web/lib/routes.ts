/**
 * Rutas traducidas.
 *
 * La URL forma parte de la interfaz: enseñar `/en/obra/1973` a un inglés es tan
 * raro como enseñarle un botón en español. Aquí vive el segmento de cada
 * sección en cada idioma, y `path()` es la ÚNICA manera correcta de construir
 * un enlace interno: si alguien escribe la ruta a mano, se salta la traducción.
 *
 * Cómo funciona por debajo: las carpetas de `app/[lang]/…` siguen llamándose en
 * español, que es el idioma por defecto, y `next.config.ts` genera desde este
 * mismo mapa las reescrituras que llevan `/en/artwork/1973` a la carpeta
 * `obra`. Hay una sola definición y no dos que se desincronizan.
 *
 * Los segmentos van sin acentos ni eñes a propósito: una URL con caracteres
 * fuera de ASCII se copia y pega percent-encoded («/fr/mus%C3%A9e/louvre»), que
 * es justo la fealdad que esto viene a evitar.
 */

import type { Lang } from './i18n';

/*
 * Solo los tres idiomas activos. Para cuando vuelvan los otros cuatro, los
 * segmentos ya estaban decididos y no hay que volver a pensarlos:
 *
 *   it: opera    · artista    · museo   · cerca
 *   de: werk     · kuenstler  · museum  · suche
 *   pt: obra     · artista    · museu   · procurar
 *   nl: werk     · kunstenaar · museum  · zoeken
 */
export const SEGMENTS = {
  artwork: { es: 'obra',    en: 'artwork', fr: 'oeuvre' },
  artist:  { es: 'artista', en: 'artist',  fr: 'artiste' },
  museum:  { es: 'museo',   en: 'museum',  fr: 'musee' },
  search:  { es: 'buscar',  en: 'search',  fr: 'recherche' },

  /* `admin` es igual en los tres idiomas, así que no genera reescritura. Y es
   * deliberado que no se traduzca: es una ruta de trabajo, no de producto. */
  admin:   { es: 'admin',   en: 'admin',   fr: 'admin' },
} as const satisfies Record<string, Record<Lang, string>>;

export type Section = keyof typeof SEGMENTS;

/**
 * La carpeta real de cada sección dentro de `app/[lang]/`. Es el segmento en
 * español porque el español es `DEFAULT_LANG`: cambiar esto obliga a renombrar
 * carpetas, así que se lee de aquí y no se escribe suelto en el config.
 */
export const CANONICAL_SEGMENT: Record<Section, string> = {
  artwork: SEGMENTS.artwork.es,
  artist: SEGMENTS.artist.es,
  museum: SEGMENTS.museum.es,
  search: SEGMENTS.search.es,
  admin: SEGMENTS.admin.es,
};

/**
 * Ruta interna de una sección, en el idioma dado.
 *
 *   path('en', 'artwork', 1973)  ->  '/en/artwork/1973'
 *   path('de', 'search')         ->  '/de/suche'
 */
export function path(lang: Lang, section: Section, rest?: string | number): string {
  const segment = SEGMENTS[section][lang];
  return rest === undefined ? `/${lang}/${segment}` : `/${lang}/${segment}/${rest}`;
}

/**
 * Pares (idioma, sección) cuyo segmento difiere del de la carpeta y necesitan
 * por tanto una reescritura. Lo consume `next.config.ts`.
 */
export function localizedRoutes(): { lang: string; segment: string; canonical: string }[] {
  const rules: { lang: string; segment: string; canonical: string }[] = [];

  for (const section of Object.keys(SEGMENTS) as Section[]) {
    const canonical = CANONICAL_SEGMENT[section];

    for (const [lang, segment] of Object.entries(SEGMENTS[section])) {
      if (segment !== canonical) rules.push({ lang, segment, canonical });
    }
  }

  return rules;
}
