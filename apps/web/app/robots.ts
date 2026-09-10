import type { MetadataRoute } from 'next';
import { LANGS } from '@/lib/i18n';
import { SEGMENTS } from '@/lib/routes';
import { trozosDelSitemap } from '@/lib/sitemap-datos';

/**
 * Qué puede rastrear un buscador, y qué no.
 *
 * **No existía**, y eso salió caro: 232.000 páginas sin una sola indicación, con
 * el buscador indexable y su espacio infinito de parámetros detrás. En agosto
 * de 2026 fueron 1,9 millones de peticiones al mes en una web que aún no se le
 * había enseñado a nadie —rastreo, no visitas— y Vercel cortó el servicio.
 *
 * Lo que se cierra son las tres cosas que un rastreador no debe tocar:
 *
 *   el panel        no es público
 *   entrar y favoritos  dependen de quién mira; para un rastreador siempre
 *                       están vacías, y además son `force-dynamic`: cada
 *                       visita es un render
 *   el buscador     `?q=` es infinito. Rastrearlo es rastrear combinaciones,
 *                   no páginas, y ninguna aporta nada que no esté ya en las
 *                   fichas
 *   todo lo que     desde que la paginación vive en la ruta, NINGUNA página de
 *   lleve `?`       contenido necesita consulta: lo que queda son ordenaciones
 *                   y filtros —`/artistas?nat=ES&orden=works`—, vistas
 *                   distintas de una lista que ya está en el sitemap. Y son
 *                   justo las páginas que siguen renderizándose en cada visita,
 *                   porque leer `searchParams` las vuelve dinámicas. Cerrarlas
 *                   quita de en medio el producto de nacionalidades por
 *                   ordenaciones por páginas, que es el sumidero que un
 *                   rastreador recorre entero sin que nadie se lo pida
 *
 * El catálogo —obras, artistas, museos, movimientos— queda abierto, que es
 * justamente lo que Artlas viene a publicar. Ahora se sirve desde la caché del
 * CDN, así que rastrearlo ya no cuesta un render por página.
 *
 * Las rutas se generan desde `SEGMENTS` y no se escriben a mano: hay tres
 * idiomas por sección y una lista escrita a mano se queda coja el día que
 * vuelvan los otros cuatro. Un `Disallow` que se olvida no avisa de nada.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const cerradas = (['login', 'favorites', 'search'] as const).flatMap((seccion) =>
    LANGS.map((lang) => `/${lang}/${SEGMENTS[seccion][lang]}`),
  );

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        // `admin` no se traduce, así que basta el comodín del idioma.
        '/*/admin',
        ...cerradas.map((ruta) => `${ruta}$`),
        ...cerradas.map((ruta) => `${ruta}/`),
        '/api/',
        // Cualquier URL con consulta. Ver la nota de arriba.
        '/*?',
      ],
    },
    /*
     * Los trozos uno a uno y no un `/sitemap.xml` a secas: el sitemap se genera
     * con `generateSitemaps`, así que Next lo sirve partido en `/sitemap/0.xml`,
     * `/sitemap/1.xml`… y no hay un índice en la raíz que los reúna. La cuenta
     * sale de `trozosDelSitemap()`, la misma que usa el sitemap, para que no
     * puedan discrepar: anunciar un trozo de menos es esconderlo.
     */
    sitemap: (await trozosDelSitemap()).map(
      (id) => `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/sitemap/${id}.xml`,
    ),
  };
}
