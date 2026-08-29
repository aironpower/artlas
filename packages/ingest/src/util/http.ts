/**
 * Cliente HTTP para APIs públicas de museos.
 *
 * Todas estas APIs son gratuitas y sin SLA: fallan, devuelven 429 y a veces
 * tardan un minuto. Aquí concentramos reintentos, rate limiting y timeouts
 * para que los conectores queden limpios.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOptions {
  headers?: Record<string, string>;
  /** Milisegundos antes de abortar. Wikidata necesita margen. */
  timeoutMs?: number;
  retries?: number;
  /** Etiqueta para los logs. */
  label?: string;
}

/** Un permiso cada `intervalMs`. Serializa las llamadas a un mismo host. */
export class RateLimiter {
  private last = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly intervalMs: number) {}

  acquire(): Promise<void> {
    this.chain = this.chain.then(async () => {
      const wait = this.last + this.intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
    });
    return this.chain;
  }
}

/*
 * Reintentos gastados desde que arrancó el proceso.
 *
 * Un contador global y no un parámetro por llamada porque quien necesita el
 * dato —la ingesta, para escribirlo junto al museo que estaba haciendo— está a
 * cinco capas de aquí, y pasarlo a mano por las cinco solo para contar sería
 * ensuciar cinco firmas. Se lee por diferencia: se anota antes de un museo y
 * después, y la resta son sus reintentos.
 *
 * El motivo de contarlos: el barrido del 28 de agosto gastó ~6.400 reintentos
 * y eso solo se veía leyendo 6.546 líneas de log. Como número, avisa de que
 * una fuente se está portando mal mientras todavía se puede hacer algo.
 */
let reintentos = 0;

export const retryCount = (): number => reintentos;

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * ¿Merece la pena reintentar esta respuesta?
 *
 * Solo 429 —"vas muy rápido", que se arregla esperando— y 5xx —"me he caído",
 * que se arregla solo—. Cualquier otro 4xx es una respuesta firme del servidor
 * y reintentarla es gastar cuota para que te digan lo mismo.
 *
 * Esto lo enseñó el Met: tras horas de peticiones nos devolvió 403 con una
 * página de bloqueo antibots, y la ingesta lo trató como un fallo pasajero.
 * Cada obra costaba dos reintentos y nueve segundos para acabar igual, así que
 * el barrido se quedó veinte minutos sin escribir una sola fila mientras
 * parecía que trabajaba. Un muro no se cae en cuatro segundos.
 */
function esReintentable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * GET con reintentos y backoff exponencial.
 *
 * Reintenta 429, 5xx y errores de red. Los demás fallos del servidor se lanzan
 * a la primera: un 404 es que la obra no existe y un 403 es que no nos dejan
 * pasar; ninguno de los dos cambia por insistir.
 */
export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { headers = {}, timeoutMs = 90_000, retries = 4, label = 'http' } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      reintentos++;
      const backoff = Math.min(2 ** attempt * 1000, 30_000) + Math.random() * 1000;
      console.warn(`  ↻ ${label}: reintento ${attempt}/${retries} en ${Math.round(backoff)}ms`);
      await sleep(backoff);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
      });

      // Transitorios: dejamos que el bucle reintente con su backoff.
      if (esReintentable(res.status)) {
        lastError = new HttpError(res.status, url, `${res.status} ${res.statusText}`);
        continue;
      }

      if (!res.ok) {
        throw new HttpError(res.status, url, `${res.status} ${res.statusText}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      // Un fallo firme del servidor sale ya; solo los transitorios y los
      // errores de red (que no son HttpError) vuelven a intentarse.
      if (err instanceof HttpError && !esReintentable(err.status)) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label}: falló tras ${retries} reintentos`);
}
