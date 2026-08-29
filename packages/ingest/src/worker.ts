#!/usr/bin/env node
/**
 * El trabajador: coge encargos de la base y los ejecuta en esta máquina.
 *
 *   npm run worker            se queda escuchando (lo normal)
 *   npm run worker -- --once  hace un encargo y sale (para probar)
 *
 * Por qué existe. Manuel quiere lanzar y seguir las ingestas y las
 * comprobaciones desde la web, y que eso dure: añadir un museo o unos cuadros
 * es tarea de siempre. Pero un barrido dura horas y la web vive en Vercel, que
 * corta las funciones a segundos; alojar algo que aguante horas cuesta dinero,
 * y el plan gratuito es una restricción del proyecto. De ahí el reparto: la web
 * **encarga** (tabla `jobs`, migración 0027), este proceso **ejecuta**, y el
 * panel enseña lo que pasa. Nadie tiene que estar delante.
 *
 * Las tres reglas que lo gobiernan:
 *
 * 1. **Los argumentos son datos, nunca una orden.** `kind` viene de una lista
 *    cerrada que se traduce aquí a un comando fijo, y cada argumento se valida
 *    contra lo que se espera. Nada de lo que llega de la web toca una línea de
 *    comandos sin pasar por `TAREAS`. Sin esto, un formulario web sería un
 *    intérprete de comandos.
 *
 * 2. **Se lanza `node` directamente, no `npm`.** En Windows `npm` es un `.cmd`
 *    que abre un `cmd.exe` que abre el `node`: matar el envoltorio deja al
 *    nieto vivo y trabajando, que es la peor forma de «parar» algo que escribe
 *    en el catálogo.
 *
 * 3. **Parar es pedirlo, no matarlo.** A una ingesta se le levanta su bandera
 *    en `ingest_runs` y ella sale entre museos; cortarla a la mitad deja museos
 *    sin checkpoint y trabajo que rehacer. Matar es el último recurso, y con
 *    plazo.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createDb } from './db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(HERE, '..');

/** Cada cuánto late y vuelca la salida acumulada. */
const LATIDO_MS = 3000;
/** Cada cuánto mira si hay encargos nuevos cuando no hay nada que hacer. */
const ESPERA_MS = 5000;
/** Cuánto se le da a una ingesta para salir sola antes de matarla. */
const GRACIA_MS = 10 * 60 * 1000;

/** Líneas de salida que se guardan en la base. El resto vive en el log. */
const LINEAS_GUARDADAS = 400;
const BYTES_GUARDADOS = 64 * 1024;

// ---------------------------------------------------------------------------
// El mapa: de encargo a comando. La lista cerrada.
// ---------------------------------------------------------------------------

type Validador = (args: Record<string, unknown>) => string[];

const qid = (v: unknown): string => {
  const s = String(v);
  if (!/^Q[1-9][0-9]*$/.test(s)) throw new Error(`QID no válido: ${s}`);
  return s;
};

const entero = (v: unknown, min: number, max: number): string => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`número fuera de rango (${min}-${max}): ${v}`);
  }
  return String(n);
};

interface Tarea {
  script: string;
  /** Traduce los argumentos del encargo a la línea de comandos. */
  banderas: Validador;
  /** Se etiqueta para que el panel sepa que hay detalle por museo. */
  esIngesta?: boolean;
}

const TAREAS: Record<string, Tarea> = {
  ingest: {
    script: 'src/cli.ts',
    esIngesta: true,
    banderas: (a) => {
      const out: string[] = [];

      if (a.museum) out.push('--museum', qid(a.museum));
      else out.push('--all');

      if (a.everything) out.push('--everything');
      if (a.force) out.push('--force');
      if (a.limit !== undefined) out.push('--limit', entero(a.limit, 1, 500_000));
      if (a.minNotability !== undefined) {
        out.push('--min-notability', entero(a.minNotability, 0, 100));
      }
      return out;
    },
  },

  /*
   * `--apply` no se pone solo. Estas tres herramientas nacieron en modo seco a
   * propósito —mueven o borran filas— y encargarlas desde un botón no cambia
   * eso: quien las pide tiene que decir explícitamente que escriba.
   */
  'fill-images': {
    script: 'src/fill-images.ts',
    banderas: (a) => (a.apply ? ['--apply'] : []),
  },
  promote: {
    script: 'src/promote.ts',
    banderas: (a) => (a.apply ? ['--apply'] : []),
  },
  audit: {
    script: 'src/audit/run.ts',
    banderas: (a) => {
      const out: string[] = [];
      if (a.images) out.push('--images');
      if (a.limit !== undefined) out.push('--limit', entero(a.limit, 1, 500_000));
      if (a.imageBudget !== undefined) out.push('--image-budget', entero(a.imageBudget, 1, 20_000));
      return out;
    },
  },
  refresh: { script: 'src/refresh-counters.ts', banderas: () => [] },
  'check-db': { script: 'src/check-db.ts', banderas: () => [] },
};

// ---------------------------------------------------------------------------
// La cola de salida que se guarda
// ---------------------------------------------------------------------------

/**
 * Guarda solo la cola de lo que escupe el proceso.
 *
 * El barrido del 28 de agosto soltó 6.546 líneas. Guardarlas enteras aquí sería
 * pagar con el espacio de la base —500 MB en total, y ya vamos por 215— por
 * algo que está en `ingesta.log`. Aquí caben las últimas, que es lo que sirve
 * para saber por dónde va.
 */
class Cola {
  private lineas: string[] = [];
  sucia = false;

  añadir(trozo: string): void {
    for (const linea of trozo.split(/\r?\n/)) {
      if (linea.trim() === '') continue;
      this.lineas.push(linea);
      this.sucia = true;
    }
    if (this.lineas.length > LINEAS_GUARDADAS) {
      this.lineas = this.lineas.slice(-LINEAS_GUARDADAS);
    }
  }

  texto(): string {
    let t = this.lineas.join('\n');
    if (t.length > BYTES_GUARDADOS) t = t.slice(-BYTES_GUARDADOS);
    return t;
  }
}

// ---------------------------------------------------------------------------
// Ejecutar un encargo
// ---------------------------------------------------------------------------

interface Job {
  id: number;
  kind: string;
  args: Record<string, unknown>;
}

async function ejecutar(db: SupabaseClient, job: Job): Promise<void> {
  const tarea = TAREAS[job.kind];

  // No debería pasar —la base tiene la misma lista— pero si pasa, se dice.
  if (!tarea) {
    await db.from('jobs').update({
      status: 'failed', finished_at: new Date().toISOString(),
      error: `el trabajador no sabe hacer «${job.kind}»`,
    }).eq('id', job.id);
    return;
  }

  let banderas: string[];

  try {
    banderas = tarea.banderas(job.args ?? {});
  } catch (err) {
    // Un argumento inválido es un encargo fallido, no un trabajador caído.
    await db.from('jobs').update({
      status: 'failed', finished_at: new Date().toISOString(),
      error: `argumentos: ${(err as Error).message}`,
    }).eq('id', job.id);
    console.error(`  ✗ #${job.id} ${job.kind}: ${(err as Error).message}`);
    return;
  }

  console.log(`▶ #${job.id} ${job.kind} ${banderas.join(' ')}`);

  await db.from('jobs').update({
    status: 'running',
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    output: null,
    error: null,
  }).eq('id', job.id);

  const hijo: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', join(RAIZ, tarea.script), ...banderas],
    { cwd: RAIZ, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const cola = new Cola();
  const registro = join(RAIZ, '..', '..', 'ingesta.log');

  /*
   * Todo lo que escupe va a dos sitios: la cola que ve el panel, y el fichero
   * de siempre. El fichero no sobra: es donde está el detalle que aquí no cabe,
   * y donde se mira cuando algo huele raro.
   */
  const recoger = (buf: Buffer) => {
    const texto = buf.toString();
    process.stdout.write(texto);
    cola.añadir(texto);
    void appendFile(registro, texto, 'utf8').catch(() => { /* el log no manda */ });
  };

  hijo.stdout?.on('data', recoger);
  hijo.stderr?.on('data', recoger);

  let runId: number | null = null;
  let cancelDesde: number | null = null;

  /**
   * Engancha el encargo con la fila que la ingesta abre por su cuenta.
   *
   * La ingesta escribe su `pid` en `ingest_runs`, y el hijo es `node` lanzado
   * directamente, así que ese pid es el que tenemos aquí. Con el enlace, el
   * panel salta del encargo al detalle museo a museo sin que el hijo tenga que
   * saber que existe un buzón.
   *
   * Se busca en cada latido Y otra vez al terminar: un museo que ya estaba
   * hecho se despacha en tres segundos, menos de lo que tarda el primer latido,
   * y el enlace se perdía justo en los trabajos más rápidos.
   */
  const buscarRun = async (): Promise<boolean> => {
    if (runId !== null || !tarea.esIngesta || !hijo.pid) return false;

    const { data } = await db.from('ingest_runs')
      .select('id').eq('pid', hijo.pid).order('started_at', { ascending: false }).limit(1);

    if (!data?.[0]) return false;
    runId = data[0].id as number;
    return true;
  };

  const latir = async () => {
    const parche: Record<string, unknown> = { heartbeat_at: new Date().toISOString() };

    if (cola.sucia) { parche.output = cola.texto(); cola.sucia = false; }

    if (await buscarRun()) parche.run_id = runId;

    await db.from('jobs').update(parche).eq('id', job.id);

    const { data: fila } = await db.from('jobs')
      .select('cancel_requested').eq('id', job.id).single();

    if (fila?.cancel_requested) await atenderCancelacion();
  };

  /**
   * Parar bien: pedirlo primero, matar solo si no hace caso.
   *
   * A la ingesta se le levanta su bandera y sale entre museos, dejando el
   * museo en curso terminado y con checkpoint. Matarla ahí en medio costaría
   * rehacerlo entero. Al resto se le manda parar directamente: no tienen ese
   * punto de corte barato.
   */
  const atenderCancelacion = async () => {
    if (cancelDesde === null) {
      cancelDesde = Date.now();

      if (tarea.esIngesta && runId !== null) {
        console.log(`  ■ #${job.id}: parada pedida; la ingesta saldrá al acabar el museo en curso`);
        await db.from('ingest_runs').update({ cancel_requested: true }).eq('id', runId);
        return;
      }

      console.log(`  ■ #${job.id}: parada pedida`);
      hijo.kill();
      return;
    }

    if (Date.now() - cancelDesde > GRACIA_MS) {
      console.warn(`  ■ #${job.id}: no ha salido en ${GRACIA_MS / 60000} min; se corta`);
      hijo.kill();
    }
  };

  // El primero enseguida: hasta el primer latido, el panel no enseña nada.
  const pronto = setTimeout(() => { void latir().catch(() => {}); }, 1200);
  const pulso = setInterval(() => { void latir().catch(() => { /* se reintenta al siguiente */ }); }, LATIDO_MS);

  const codigo: number = await new Promise((resolve) => {
    hijo.on('close', (c) => resolve(c ?? -1));
    hijo.on('error', () => resolve(-1));
  });

  clearTimeout(pronto);
  clearInterval(pulso);
  await buscarRun();

  const cancelado = cancelDesde !== null;
  const estado = cancelado ? 'cancelled' : codigo === 0 ? 'done' : 'failed';

  await db.from('jobs').update({
    status: estado,
    finished_at: new Date().toISOString(),
    exit_code: codigo,
    output: cola.texto(),
    run_id: runId,
    error: estado === 'failed' ? `terminó con código ${codigo}` : null,
  }).eq('id', job.id);

  console.log(`${estado === 'done' ? '✓' : '✗'} #${job.id} ${job.kind}: ${estado} (código ${codigo})\n`);
}

// ---------------------------------------------------------------------------
// El bucle
// ---------------------------------------------------------------------------

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Coge el siguiente encargo, si lo hay.
 *
 * El `eq('status', 'queued')` dentro del propio UPDATE es lo que hace que dos
 * trabajadores no se lleven el mismo: quien pierda la carrera no actualiza
 * ninguna fila y se va de vacío. No está previsto arrancar dos, pero un buzón
 * que solo funciona si nadie se equivoca no es un buzón.
 */
async function siguiente(db: SupabaseClient): Promise<Job | null> {
  const { data: cola } = await db.from('jobs')
    .select('id, kind, args').eq('status', 'queued')
    .order('requested_at').limit(1);

  const candidato = cola?.[0];
  if (!candidato) return null;

  const { data: cogido } = await db.from('jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', candidato.id).eq('status', 'queued')
    .select('id, kind, args');

  return cogido?.[0] ? (cogido[0] as Job) : null;
}

async function main() {
  const unaVez = process.argv.includes('--once');
  const db = createDb();

  await mkdir(join(RAIZ, '.checkpoints'), { recursive: true }).catch(() => { /* ya está */ });

  console.log(`Artlas · trabajador en ${hostname()} (pid ${process.pid})`);
  console.log(`Escuchando encargos${unaVez ? ' (solo uno)' : ''}. Se piden desde /es/admin/ingesta.\n`);

  for (;;) {
    try {
      /*
       * Enterrar antes de coger. Si el ordenador se apagó con un encargo en
       * curso, su fila sigue diciendo `running` y `request_job` no deja pedir
       * otro igual: el buzón se queda atascado hasta que alguien lo mire. Esto
       * lo desatasca solo.
       */
      await db.rpc('reap_dead_jobs');

      const job = await siguiente(db);

      if (job) {
        await ejecutar(db, job);
        if (unaVez) break;
        continue;
      }

      if (unaVez) { console.log('No hay nada encargado.'); break; }
    } catch (err) {
      /*
       * Ni un fallo de red ni una base que no responde pueden tumbar al
       * trabajador: si se muriera cada vez que Supabase parpadea, habría que
       * arrancarlo a mano, que es justo lo que esto viene a evitar.
       */
      console.warn(`  (no se pudo hablar con la base: ${(err as Error).message})`);
    }

    await dormir(ESPERA_MS);
  }
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`);
  process.exit(1);
});
