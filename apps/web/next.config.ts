import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { localizedRoutes } from './lib/routes';

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
