/**
 * El estado de la ingesta, en la base de datos.
 *
 * Antes de esto, saber cómo iba un barrido era leer `ingesta.log` y sumar de
 * cabeza. El del 28 de agosto de 2026 tenía 6.546 líneas, de las que ~6.400
 * eran reintentos; Filadelfia murió a las 19:17 y se supo catorce horas
 * después. El log sigue existiendo y sigue siendo el sitio del detalle, pero
 * el ESTADO —en qué museo va, qué terminó con qué cifras, qué falló y por
 * qué— vive aquí, en `ingest_runs` e `ingest_steps` (migración 0026), donde el
 * panel puede leerlo sin que nadie abra un fichero.
 *
 * Dos reglas que gobiernan todo este módulo:
 *
 * 1. **Contar nunca puede tumbar la ingesta.** Si Supabase no responde a un
 *    `update` de progreso, se avisa por consola y se sigue: perder el catálogo
 *    por no poder escribir un contador sería absurdo. Por eso cada método
 *    envuelve su escritura y ninguno propaga.
 *
 * 2. **Pero el fallo se dice.** Callar aquí reproduciría exactamente el
 *    problema que este módulo viene a resolver, así que el primer fallo de
 *    escritura se anuncia en voz alta —una vez, no 6.400— y el resumen final
 *    recuerda que el panel se quedó ciego.
 */

import { hostname } from 'node:os';
import type { SupabaseClient } from '@supabase/supabase-js';

import { retryCount } from './util/http.js';
import type { IngestStats, MuseumSeed } from './types.js';

/** Cómo terminó un museo. `incomplete` = escribió obras, pero perdió lotes. */
export type StepStatus = 'done' | 'failed' | 'skipped' | 'incomplete';

/** Cómo terminó una ejecución entera. */
export type RunStatus = 'done' | 'failed' | 'cancelled';

export class RunLog {
  private runId: number | null = null;
  private stepId: number | null = null;
  private retriesAlEmpezarPaso = 0;
  private museumsDone = 0;
  private avisado = false;
  private pulso: NodeJS.Timeout | null = null;

  private constructor(private readonly db: SupabaseClient) {}

  /**
   * Abre una ejecución.
   *
   * Lo primero que hace es enterrar a las anteriores: si el proceso murió de
   * golpe, su fila sigue diciendo `running` y el panel la enseñaría como viva
   * para siempre. `reap_dead_runs()` la cierra con el motivo. Se hace al
   * arrancar y no solo al pintar el panel porque quien arranca sabe algo que
   * el panel no puede saber: que la anterior, si estaba en esta máquina, ya no
   * está.
   */
  static async open(
    db: SupabaseClient,
    command: string,
    museumsTotal: number,
  ): Promise<RunLog> {
    const log = new RunLog(db);

    await log.intentar('enterrar ejecuciones muertas', async () => {
      const { data } = await db.rpc('reap_dead_runs');
      if (typeof data === 'number' && data > 0) {
        console.warn(`  ⚠ ${data} ejecución(es) anterior(es) habían muerto sin avisar; cerradas.`);
      }
    });

    await log.intentar('abrir la ejecución', async () => {
      const { data, error } = await db
        .from('ingest_runs')
        .insert({
          command,
          host: hostname(),
          pid: process.pid,
          museums_total: museumsTotal,
        })
        .select('id')
        .single();

      if (error) throw error;
      log.runId = data.id as number;
    });

    if (log.runId !== null) {
      console.log(`Ejecución #${log.runId} · se sigue en /es/admin/ingesta`);

      /*
       * El latido va por reloj y no por trabajo hecho, y la diferencia importa:
       * significa «el proceso existe», no «el proceso avanza». Atado a los
       * lotes, una consulta atascada —hasta 8 min entre reintentos— dejaba de
       * latir estando viva, y el vigilante la habría enterrado. Que avance o no
       * se ve aparte, en las cifras del museo en curso y en sus reintentos:
       * son dos preguntas distintas y merecen dos respuestas distintas.
       *
       * `unref()` para que este temporizador no sea motivo de que el proceso
       * siga vivo cuando ya no queda nada que hacer.
       */
      log.pulso = setInterval(() => { void log.latir(); }, 30_000);
      log.pulso.unref();
    }

    return log;
  }

  /** ¿Está registrando de verdad, o se quedó sin base? */
  get id(): number | null {
    return this.runId;
  }

  /** Empieza un museo. Late, porque un museo grande tarda en volver. */
  async startStep(position: number, museum: MuseumSeed): Promise<void> {
    this.retriesAlEmpezarPaso = retryCount();
    this.stepId = null;

    if (this.runId === null) return;

    await this.intentar('anotar el museo', async () => {
      const { data, error } = await this.db
        .from('ingest_steps')
        .insert({
          run_id: this.runId,
          position,
          museum_qid: museum.qid,
          museum_name: museum.name,
        })
        .select('id')
        .single();

      if (error) throw error;
      this.stepId = data.id as number;
    });

    await this.latir();
  }

  /**
   * Cierra el museo con sus cifras.
   *
   * El estado NO es una opinión de quien llama: `incomplete` sale de que haya
   * obras perdidas, y esa es justo la distinción que el log no sabía hacer
   * —«el museo está hecho» frente a «el museo parece hecho»—.
   */
  async finishStep(
    stats: IngestStats,
    opts: { skipped?: boolean; error?: Error | null; note?: string } = {},
  ): Promise<void> {
    this.museumsDone++;

    const status: StepStatus = opts.skipped
      ? 'skipped'
      : opts.error
        ? 'failed'
        : stats.lostWorks > 0
          ? 'incomplete'
          : 'done';

    if (this.stepId !== null) {
      const id = this.stepId;

      await this.intentar('cerrar el museo', async () => {
        const { error } = await this.db
          .from('ingest_steps')
          .update({
            status,
            finished_at: new Date().toISOString(),
            fetched: stats.fetched,
            inserted: stats.inserted,
            updated: stats.updated,
            unchanged: stats.unchanged,
            published: stats.published,
            pending: stats.pending,
            rejected: stats.rejected,
            duplicated: stats.skipped,
            repaired: stats.repaired,
            lost_works: stats.lostWorks,
            lost_batches: stats.lostBatches,
            retries: retryCount() - this.retriesAlEmpezarPaso,
            error: opts.error ? opts.error.message : null,
            note: opts.note ?? null,
          })
          .eq('id', id);

        if (error) throw error;
      });
    }

    this.stepId = null;
    await this.latir();
  }

  /**
   * Progreso DENTRO de un museo, una vez por lote escrito.
   *
   * Es la otra mitad de la pregunta que responde el latido. El latido dice que
   * el proceso existe; esto dice que además avanza. Sin ello, un museo de dos
   * horas no enseña una sola cifra hasta el final y no hay forma de distinguir
   * «trabajando» de «atascado con la luz encendida» —que es lo que le pasó a
   * Filadelfia—.
   *
   * Cuesta un UPDATE por lote, unos 85 en el museo más grande. A esta escala no
   * se nota.
   */
  async progress(stats: IngestStats): Promise<void> {
    if (this.stepId !== null) {
      const id = this.stepId;

      await this.intentar('anotar el avance', async () => {
        await this.db
          .from('ingest_steps')
          .update({
            fetched: stats.fetched,
            inserted: stats.inserted,
            updated: stats.updated,
            unchanged: stats.unchanged,
            published: stats.published,
            pending: stats.pending,
            rejected: stats.rejected,
            duplicated: stats.skipped,
            repaired: stats.repaired,
            lost_works: stats.lostWorks,
            lost_batches: stats.lostBatches,
            retries: retryCount() - this.retriesAlEmpezarPaso,
          })
          .eq('id', id);
      });
    }
  }

  /**
   * ¿Han pedido que pare desde el panel?
   *
   * Se pregunta entre museos y no dentro: cortar un museo por la mitad lo deja
   * sin checkpoint y el siguiente barrido lo rehace entero, así que parar «ya
   * mismo» costaría más trabajo del que ahorra. Entre museos, en cambio, lo
   * hecho queda hecho.
   *
   * Si la base no contesta, se sigue. Una ingesta que se para sola porque no
   * pudo leer una bandera es peor que una que no se puede parar.
   */
  async cancelPedido(): Promise<boolean> {
    if (this.runId === null) return false;

    const { data, error } = await this.db
      .from('ingest_runs')
      .select('cancel_requested')
      .eq('id', this.runId)
      .single();

    if (error) return false;
    return data?.cancel_requested === true;
  }

  /** Cierra la ejecución con su resumen. */
  async close(status: RunStatus, stats: IngestStats, error?: Error | null): Promise<void> {
    if (this.pulso) { clearInterval(this.pulso); this.pulso = null; }
    if (this.runId === null) return;
    const id = this.runId;

    await this.intentar('cerrar la ejecución', async () => {
      const { error: err } = await this.db
        .from('ingest_runs')
        .update({
          status,
          finished_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          museums_done: this.museumsDone,
          error: error ? error.message : null,
          stats: { ...stats, retries: retryCount() },
        })
        .eq('id', id);

      if (err) throw err;
    });
  }

  /**
   * «Sigo aquí».
   *
   * Es lo que separa un proceso vivo de uno muerto: sin latido, ambos se ven
   * igual desde fuera —una fila que dice `running`—, que es exactamente la
   * ceguera del 28 de agosto. Lo dispara el reloj cada 30 s, y también los
   * comienzos y finales de museo, que son los momentos en que cambia
   * `museums_done`.
   */
  private async latir(): Promise<void> {
    if (this.runId === null) return;
    const id = this.runId;

    await this.intentar('latir', async () => {
      await this.db
        .from('ingest_runs')
        .update({ heartbeat_at: new Date().toISOString(), museums_done: this.museumsDone })
        .eq('id', id);
    });
  }

  /**
   * Ejecuta una escritura de seguimiento sin que su fallo suba.
   *
   * El aviso sale UNA vez por ejecución. Avisar en cada museo convertiría este
   * módulo en la clase de ruido que vino a eliminar; no avisar nunca lo
   * convertiría en la clase de silencio que vino a eliminar.
   */
  private async intentar(que: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (!this.avisado) {
        this.avisado = true;
        console.warn(
          `  ⚠ No se puede escribir el estado en la base (${que}: ${(err as Error).message}).\n` +
          '    La ingesta sigue, pero el panel NO la verá. El log de texto es lo único que queda.',
        );
      }
    }
  }

  /** ¿Se quedó ciego el panel en algún momento? Lo dice el resumen final. */
  get ciego(): boolean {
    return this.avisado || this.runId === null;
  }
}
