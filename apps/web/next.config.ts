import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { localizedRoutes, paginatedRoutes } from './lib/routes';

/*
 * Las credenciales viven en el .env de la RAÍZ del monorepo, compartido con la
 * ingesta, mientras que Next solo mira el .env de su propia carpeta. Cargarlo
 * aquí evita tener dos ficheros de secretos que se desincronizan: uno de los
 * dos acaba con una clave caducada y el error resultante no dice por qué.
 *
 * Se usa `process.loadEnvFile` de Node y NO `loadEnvConfig` de @next/env: este
 * último cachea el resultado por proceso, y para cuando se evalúa next.config
 * Next ya lo ha llamado apuntando a apps/web. La segunda llamada, la nuestra,
 * no hace nada — comprobado: devolvía las variables vacías sin dar ningún
 * error, y el build fallaba después con un mensaje que señalaba al sitio
 * equivocado.
 */
try {
  process.loadEnvFile(resolve(process.cwd(), '../..', '.env'));
} catch {
  // Sin .env se sigue adelante: en producción las variables vienen del entorno
  // del hosting (Vercel, Docker...), no de un fichero.
}

/*
 * Y hay que propagarlas con `env` además de cargarlas: `loadEnvConfig` las deja
 * en el process.env de ESTE proceso, pero la generación estática ocurre en
 * procesos worker aparte, que solo reciben lo que Next les pasa explícitamente.
 * Sin esto compila bien y luego falla al prerenderizar, diciendo que faltan
 * unas variables que sí están cargadas.
 */
const config: NextConfig = {
  /*
   * Dónde deja Next lo compilado. Normalmente `.next`, pero se puede mover con
   * una variable de entorno, y eso resuelve un tropiezo real: con un
   * `next start` sirviendo `.next` en un puerto, compilar o levantar el modo
   * desarrollo BORRA lo que ese servidor está leyendo. Pasó una vez y llevó a
   * concluir en voz alta que las URLs traducidas rompían la portada.
   *
   *   NEXT_DIST_DIR=.next-dev npx next dev -p 3112
   *
   * En Vercel no está definida, así que allí sigue siendo `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  /*
   * URLs traducidas. Las carpetas de `app/[lang]/` se llaman en español —el
   * idioma por defecto— y estas reescrituras hacen que `/en/artwork/1973` sirva
   * la carpeta `obra` sin que el usuario vea una palabra en español en la barra
   * de direcciones. El mapa de segmentos vive en `lib/routes.ts` y lo usan tanto
   * esto como los enlaces de la app, para que no puedan discrepar.
   *
   * Las rutas en español siguen funcionando en cualquier idioma; no se
   * redirigen. Un enlace viejo o compartido no debe romperse por un cambio de
   * cosmética en la URL.
   */
  async rewrites() {
    return localizedRoutes().map(({ lang, segment, canonical }) => ({
      source: `/${lang}/${segment}/:rest*`,
      destination: `/${lang}/${canonical}/:rest*`,
    }));
  },

  /*
   * Las listas de artista y museo llevaban la página en la consulta (`?p=2`) y
   * ahora la llevan en el camino (`/p/2`). El motivo está en sus páginas: leer
   * `searchParams` las volvía dinámicas y anulaba su `revalidate = 3600`.
   *
   * Esto redirige lo viejo, y no es un detalle: esas URLs están indexadas y
   * compartidas. Un 308 —permanente— le dice al buscador que mueva lo que
   * tenía en vez de tratarla como una página nueva.
   *
   * UNA regla por idioma y sección, y solo para `?p=2` o más. Lo que quede
   * fuera —`?p=1`, `?p=0`, `?p=abc`— no se redirige: la página ya no mira la
   * consulta, así que sirve la primera página, que es exactamente lo que esas
   * URLs pedían. Y no redirigirlas evita el bucle que tendría una regla cuyo
   * destino es su propio origen: Next arrastra al destino los parámetros que
   * no ha consumido, así que `->` el mismo camino volvería a entrar por aquí.
   *
   * `[0-9]` y no `\d`: esto es una cadena de TypeScript, y `'\d'` se evalúa
   * como `'d'` —JavaScript se come las barras de escape que no conoce—. La
   * expresión habría dejado de aceptar dígitos sin dar un solo error.
   */
  async redirects() {
    return paginatedRoutes().map(({ lang, segment }) => ({
      source: `/${lang}/${segment}/:slug`,
      has: [{ type: 'query' as const, key: 'p', value: '(?<pagina>[2-9][0-9]*|1[0-9]+)' }],
      destination: `/${lang}/${segment}/:slug/p/:pagina`,
      permanent: true,
    }));
  },

  /*
   * `noindex` en todas las respuestas, no solo en el HTML: también en imágenes
   * optimizadas y rutas de la API. Es la segunda capa de `app/robots.ts`, para
   * el buscador que llega por un enlace sin haber leído antes el robots.txt.
   */
  async headers() {
    return [{
      source: '/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }];
  },

  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? '',
  },

  // Las imágenes vienen de Commons y de las APIs de los museos. Se listan los
  // hosts uno a uno en vez de abrirlo a cualquiera: una obra con una URL
  // manipulada no debe poder hacer que el servidor descargue de donde sea.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
      { protocol: 'http',  hostname: 'commons.wikimedia.org' },
      { protocol: 'https', hostname: 'images.metmuseum.org' },
      { protocol: 'https', hostname: 'www.artic.edu' },
      { protocol: 'https', hostname: 'nrs.harvard.edu' },
    ],
  },
};

export default config;
