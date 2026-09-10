import type { MetadataRoute } from 'next';
import { LANGS, type Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';
import {
  OBRAS_EN_SITEMAP, idsDeObras, slugsDelCatalogo, tramoDelTrozo, trozosDelSitemap,
} from '@/lib/sitemap-datos';

/**
 * El mapa del sitio, para que un buscador sepa qué hay sin adivinarlo.
 *
 * **No existía.** Un catálogo de 232.000 páginas sin sitemap y sin robots es un
 * catálogo que un rastreador recorre a tientas, tirando de enlaces y probando
 * combinaciones del buscador. Salió en la factura de agosto de 2026.
 *
 * Se sirve como ISR con un día de vida: el esqueleto son doce viajes a la base
 * y el catálogo no cambia de un minuto a otro. Recalcularlo en cada petición
 * sería repetir el error que se está arreglando.
 *
 * Qué lleva y qué no lo decide `OBRAS_EN_SITEMAP` en `lib/sitemap-datos.ts`,
 * donde está explicado por qué las obras están fuera por ahora.
 */
export const revalidate = 86_400;

export async function generateSitemaps() {
  return (await trozosDelSitemap()).map((id) => ({ id }));
}

/*
 * `id` se declara `number | string` y se pasa por `Number()` a propósito.
 *
 * `generateSitemaps` los devuelve como números, pero a la función llegan desde
 * el segmento de la URL —`/sitemap/0.xml`—, así que son cadenas. Con la
 * comparación estricta `id === 0` el trozo 0 caía en la rama de las obras, que
 * está apagada, y `/sitemap/0.xml` se servía VACÍO: un XML bien formado, sin
 * una sola URL y sin un solo error. No lo habría contado nadie más que un
 * buscador, y en silencio.
 */
export default async function sitemap(
  { id }: { id: number | string },
): Promise<MetadataRoute.Sitemap> {
  const trozo = Number(id);
  return trozo === 0 ? esqueleto() : obras(trozo);
}

/**
 * Portada, índices y fichas de museo y de artista, en los tres idiomas.
 *
 * **Lo que NO va, y no es olvido:**
 *
 *   el buscador     `robots.ts` lo cierra: `?q=` es un espacio infinito
 *   los movimientos no tienen ficha propia, se ven filtrando el buscador
 *   `/p/2` y demás  son la misma lista continuada, no páginas que ofrecer;
 *                   el rastreador las sigue por el enlace «Siguiente» si le
 *                   interesa, y así reparte el trabajo en el tiempo
 */
async function esqueleto(): Promise<MetadataRoute.Sitemap> {
  const [artistas, museos] = await Promise.all([
    slugsDelCatalogo('artists'),
    slugsDelCatalogo('institutions'),
  ]);

  return [
    entrada((lang) => `/${lang}`),
    ...(['museums', 'artists', 'movements'] as const).map(
      (seccion) => entrada((lang) => path(lang, seccion)),
    ),
    ...museos.map((slug) => entrada((lang) => path(lang, 'museum', slug))),
    ...artistas.map((slug) => entrada((lang) => path(lang, 'artist', slug))),
  ].flat();
}

/** Las fichas de obra de un trozo, si están encendidas. */
async function obras(id: number): Promise<MetadataRoute.Sitemap> {
  if (!OBRAS_EN_SITEMAP) return [];

  const { desde, cuantas } = tramoDelTrozo(id);
  const ids = await idsDeObras(desde, cuantas);

  return ids.map((obra) => entrada((lang) => path(lang, 'artwork', obra))).flat();
}

/**
 * Una página, en sus tres idiomas: tres entradas que se declaran alternativas
 * unas de otras.
 *
 * El `alternates.languages` importa: sin él, `/es/artista/goya` y
 * `/en/artist/goya` compiten entre ellas como si fueran páginas distintas con
 * el mismo contenido, y el buscador elige una y descarta las otras dos.
 */
function entrada(ruta: (lang: Lang) => string): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? '';

  const languages = Object.fromEntries(
    LANGS.map((lang) => [lang, `${base}${ruta(lang)}`]),
  );

  return LANGS.map((lang) => ({
    url: `${base}${ruta(lang)}`,
    alternates: { languages },
  }));
}
