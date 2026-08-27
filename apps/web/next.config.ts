import { resolve } from 'node:path';
import type { NextConfig } from 'next';

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
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
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
