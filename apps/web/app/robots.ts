import type { MetadataRoute } from 'next';

/**
 * Ningún rastreador entra. Ni sitemap.
 *
 * Artlas ya no busca salir en Google: es una demo que se enseña con un enlace.
 * Y el rastreo es lo que la tumbó. En agosto de 2026, con 232.000 páginas
 * abiertas, fueron 1,9 millones de peticiones al mes —rastreo, no visitas—
 * contra el tope de 1 millón del plan gratuito de Vercel, que cortó el
 * servicio. Cerrar solo el buscador y los filtros (lo que se hizo entonces)
 * bajaba los renders, pero no las peticiones: una ficha servida desde la caché
 * sigue contando una.
 *
 * Esto lo respetan los buscadores serios. Para los que no, está la cabecera
 * `X-Robots-Tag` de `next.config.ts` y el firewall de Vercel.
 *
 * El sitemap se ha borrado con el mismo motivo: anunciar 232.000 URLs es
 * invitar a recorrerlas.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
