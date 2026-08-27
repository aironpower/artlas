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

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * GET con reintentos y backoff exponencial.
 *
 * Reintenta 429, 5xx y errores de red. Un 404 no se reintenta: la obra
 * simplemente no existe y reintentar solo gasta cuota.
 */
export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { headers = {}, timeoutMs = 90_000, retries = 4, label = 'http' } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
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

      if (res.status === 404) {
        throw new HttpError(404, url, `no encontrado`);
      }

      // 429/5xx son transitorios: dejamos que el bucle reintente.
      if (res.status === 429 || res.status >= 500) {
        lastError = new HttpError(res.status, url, `${res.status} ${res.statusText}`);
        continue;
      }

      if (!res.ok) {
        throw new HttpError(res.status, url, `${res.status} ${res.statusText}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label}: falló tras ${retries} reintentos`);
}
