import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import AutoRefresh from '@/components/AutoRefresh';
import BuscarMuseo from '@/components/BuscarMuseo';

/*
 * Nunca en caché, y aquí no es una preferencia: la pantalla existe para
 * responder «¿en qué va AHORA?». Una versión de hace un minuto contestaría a
 * otra pregunta.
 */
export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ lang: string }> }

interface Job {
  id: number;
  kind: string;
  args: Record<string, unknown>;
  status: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  cancel_requested: boolean;
  exit_code: number | null;
  error: string | null;
  output: string | null;
  run_id: number | null;
}

interface Trabajador {
  host: string;
  pid: number | null;
  started_at: string;
  last_seen: string;
  job_id: number | null;
}

interface Run {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  command: string | null;
  host: string | null;
  pid: number | null;
  museums_total: number | null;
  museums_done: number;
  heartbeat_at: string;
  cancel_requested: boolean;
  error: string | null;
  stats: Record<string, number>;
}

interface Step {
  id: number;
  position: number;
  museum_qid: string;
  museum_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  fetched: number;
  inserted: number;
  published: number;
  pending: number;
  rejected: number;
  duplicated: number;
  repaired: number;
  lost_works: number;
  lost_batches: number;
  retries: number;
  error: string | null;
}

/**
 * Ingestas y comprobaciones: pedirlas y seguirlas, sin terminal.
 *
 * Sustituye a leer `ingesta.log` con `tail`. El caso que la justifica: el
 * barrido del 28 de agosto de 2026 dejó 6.546 líneas de log, Filadelfia agotó
 * sus reintentos y murió a las 19:17, y se supo catorce horas después.
 *
 * Lo que se pide aquí NO se ejecuta aquí: se deja en la tabla `jobs` y lo coge
 * el trabajador de casa (`npm run worker`). La web corta las funciones a
 * segundos y un barrido dura horas; ese reparto es lo que hace que esto se
 * pueda usar de verdad y siga siendo gratis.
 */
export default async function IngestaPage({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  /*
   * Enterrar a los muertos ANTES de leer. Un proceso que se cae de golpe deja
   * su fila diciendo `running` para siempre, y esta pantalla lo enseñaría «en
   * curso» con la misma cara de tranquilidad que tenía el log del 28 — que es
   * exactamente el fallo que vino a arreglar. Y un encargo muerto sin enterrar
   * atasca el buzón: `request_job` no deja pedir otro igual.
   */
  await Promise.all([db.rpc('reap_dead_runs'), db.rpc('reap_dead_jobs')]);

  const { data: rawJobs } = await db.from('jobs')
    .select('*').order('requested_at', { ascending: false }).limit(15);

  const encargos = (rawJobs ?? []) as Job[];
  const activo = encargos.find((j) => j.status === 'running' || j.status === 'queued');

  /*
   * ¿Hay alguien al otro lado? Es la primera pregunta de esta pantalla y hasta
   * ahora no tenía respuesta: `jobs.heartbeat_at` solo late mientras se ejecuta
   * algo, así que un trabajador esperando y un trabajador apagado se veían
   * igual. Quien pulsara un botón con el ordenador de casa apagado veía su
   * encargo «en cola» sin ninguna explicación.
   */
  const { data: rawWorkers } = await db.from('workers')
    .select('*').order('last_seen', { ascending: false }).limit(5);

  const trabajadores = (rawWorkers ?? []) as Trabajador[];

  const { data: rawRuns } = await db.from('ingest_runs')
    .select('*').order('started_at', { ascending: false }).limit(1);

  const ejecucion = (rawRuns ?? [])[0] as Run | undefined;

  const { data: rawSteps } = ejecucion
    ? await db.from('ingest_steps').select('*').eq('run_id', ejecucion.id).order('position')
    : { data: [] };

  const pasos = (rawSteps ?? []) as Step[];
  const vivo = Boolean(activo) || ejecucion?.status === 'running';

  async function encargar(formData: FormData) {
    'use server';

    const kind = String(formData.get('kind'));

    /*
     * Lista blanca, no barrido del formulario.
     *
     * Recorrer `formData.entries()` parecía equivalente y no lo es: Next mete
     * sus propios campos ocultos para las acciones de servidor, y acababan
     * guardados como argumentos —`$ACTION_13:0=...` salió impreso en la propia
     * pantalla—. El trabajador los ignoraba, así que no era un agujero, pero
     * guardar en la base lo que un formulario traiga por su cuenta es la forma
     * de que un día sí lo sea.
     */
    const TEXTO = ['museum'] as const;
    const NUMERO = ['limit', 'minNotability', 'imageBudget'] as const;
    const SI_O_NO = ['everything', 'force', 'apply', 'images'] as const;

    const args: Record<string, unknown> = {};

    for (const clave of TEXTO) {
      const v = String(formData.get(clave) ?? '').trim();
      if (v) args[clave] = v;
    }
    for (const clave of NUMERO) {
      const v = formData.get(clave);
      if (v !== null && v !== '') args[clave] = Number(v);
    }
    for (const clave of SI_O_NO) {
      if (formData.get(clave) !== null) args[clave] = true;
    }

    const server = await supabaseServer();

    /*
     * La comprobación de rol vive DENTRO de `request_job`, y la lista de lo que
     * se puede encargar está en la propia tabla. Esta pantalla no es la
     * garantía: la base rechaza a quien no es administrador y rechaza un tipo
     * de trabajo que no exista, aunque alguien llame a la API por su cuenta.
     */
    const { error } = await server.rpc('request_job', { p_kind: kind, p_args: args });
    if (error) console.error('encargar:', error.message);

    revalidatePath(`${path(idioma, 'admin')}/ingesta`);
  }

  async function cancelar(formData: FormData) {
    'use server';
    const server = await supabaseServer();
    await server.rpc('cancel_job', { p_id: Number(formData.get('id')) });
    revalidatePath(`${path(idioma, 'admin')}/ingesta`);
  }

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted"><Link href={path(idioma, 'admin')}>← Panel</Link></p>
        <h1>Ingestas y comprobaciones</h1>
        <AutoRefresh activo={vivo} />
      </header>

      <section>
        <h2>Pedir un trabajo</h2>
        <Trabajadores lista={trabajadores} />

        <ul className="findings">
          <Encargo
            titulo="Añadir o actualizar un museo"
            pie="Búscalo por su nombre. Si no lo tenemos todavía, se añade; si ya está, se actualiza."
            kind="ingest" accion={encargar}
          >
            <BuscarMuseo lang={idioma} />
            <Casilla name="everything" etiqueta="todo lo que exista" />
            <Casilla name="force" etiqueta="rehacer aunque esté hecho" />
          </Encargo>

          <Encargo
            titulo="Barrido completo"
            pie="Todos los museos que conocemos. Horas de trabajo: se puede parar y se reanuda por donde iba."
            kind="ingest" accion={encargar}
          >
            <Casilla name="everything" etiqueta="todo lo que exista" />
          </Encargo>

          <Encargo
            titulo="Buscar las imágenes que faltan"
            pie="Pregunta a la API del propio museo por las obras que esperan una imagen."
            kind="fill-images" accion={encargar}
          >
            <Casilla name="apply" etiqueta="escribir de verdad" />
          </Encargo>

          <Encargo
            titulo="Publicar las que ya se pueden"
            pie="Revisa las obras que esperaban y publica las que ya tienen lo que les faltaba."
            kind="promote" accion={encargar}
          >
            <Casilla name="apply" etiqueta="escribir de verdad" />
          </Encargo>

          <Encargo
            titulo="Auditar el catálogo"
            pie="Busca problemas y los deja en la bandeja de hallazgos. Con imágenes tarda horas."
            kind="audit" accion={encargar}
          >
            <Casilla name="images" etiqueta="comprobar también las imágenes" />
          </Encargo>

          <Encargo titulo="Recalcular contadores" pie="Obras por museo, por artista y por movimiento."
            kind="refresh" accion={encargar} />

          <Encargo titulo="Comprobar la base" pie="Esquema, credenciales y espacio ocupado."
            kind="check-db" accion={encargar} />
        </ul>
      </section>

      <section style={{ paddingTop: 26 }}>
        <h2>La cola</h2>

        {encargos.length === 0 ? (
          <p className="muted small" style={{ marginTop: 12 }}>Nada encargado todavía.</p>
        ) : (
          <ul className="findings">
            {encargos.map((j) => (
              <li key={j.id}>
                <div style={{ flex: 1 }}>
                  <Estado estado={j.status} />
                  <span style={{ marginLeft: 8, fontWeight: 600 }}>{j.kind}</span>
                  <span className="muted small"> {resumirArgs(j.args)}</span>
                  <span className="muted small"> · #{j.id} · {cuando(j.requested_at)}</span>

                  {j.error && (
                    <p className="small" style={{ margin: '4px 0 0', color: 'var(--accent)' }}>{j.error}</p>
                  )}

                  {j.cancel_requested && j.status === 'running' && (
                    <p className="muted small" style={{ margin: '4px 0 0' }}>
                      Parada pedida. Sale en cuanto pueda hacerlo sin dejar trabajo a medias.
                    </p>
                  )}

                  {j.status === 'running' && j.output && (
                    <pre className="salida">{ultimasLineas(j.output, 14)}</pre>
                  )}
                </div>

                {(j.status === 'running' || j.status === 'queued') && !j.cancel_requested && (
                  <form action={cancelar} className="acciones">
                    <input type="hidden" name="id" value={j.id} />
                    <button className="btn" type="submit">
                      {j.status === 'queued' ? 'Quitar de la cola' : 'Parar'}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {ejecucion && (
        <section style={{ paddingTop: 26 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Estado estado={ejecucion.status} />
            <span>Última ingesta, museo a museo</span>
          </h2>

          {ejecucion.error && (
            <p style={{ color: 'var(--accent)', margin: '10px 0 0' }}>{ejecucion.error}</p>
          )}

          <ul className="facts">
            <Fact k="Museos" v={
              `${formatNumber(idioma, ejecucion.museums_done)} de ` +
              `${formatNumber(idioma, ejecucion.museums_total ?? 0)}`
            } />
            <Fact k={ejecucion.status === 'running' ? 'Lleva' : 'Duró'} v={
              duracion(ejecucion.started_at, ejecucion.finished_at ?? new Date().toISOString())
            } />
            {ejecucion.status === 'running' &&
              <Fact k="Última señal" v={hace(ejecucion.heartbeat_at)} />}
            <Fact k="Escritas" v={formatNumber(idioma, ejecucion.stats.inserted ?? 0)} />
            {(ejecucion.stats.lostWorks ?? 0) > 0 && (
              <Fact k="Obras perdidas" v={formatNumber(idioma, ejecucion.stats.lostWorks!)} />
            )}
            {(ejecucion.stats.retries ?? 0) > 0 && (
              <Fact k="Reintentos" v={formatNumber(idioma, ejecucion.stats.retries!)} />
            )}
            <Fact k="Dónde" v={`${ejecucion.host ?? '?'} · pid ${ejecucion.pid ?? '?'}`} />
          </ul>

          {pasos.length > 0 && (
            <ul className="findings">
              {[...pasos].reverse().map((p) => (
                <li key={p.id}>
                  <div>
                    <Estado estado={p.status} />
                    <span style={{ marginLeft: 8 }}>{p.museum_name}</span>
                    <span className="muted small"> · {p.museum_qid}</span>
                    <p className="muted small" style={{ margin: '4px 0 0' }}>{cifras(idioma, p)}</p>
                    {p.error && (
                      <p className="small" style={{ margin: '4px 0 0', color: 'var(--accent)' }}>{p.error}</p>
                    )}
                  </div>
                  <span className="muted small" style={{ flexShrink: 0 }}>
                    {p.finished_at ? duracion(p.started_at, p.finished_at) : hace(p.started_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="small muted" style={{ marginTop: 20 }}>
        El detalle completo sigue en <code>ingesta.log</code>. Aquí vive el estado: qué se
        pidió, en qué va, qué terminó con qué números y qué falló.
      </p>
    </>
  );
}

/** Un trabajo que se puede pedir: su explicación, sus opciones y su botón. */
function Encargo({ titulo, pie, kind, accion, children }: {
  titulo: string; pie: string; kind: string;
  accion: (fd: FormData) => Promise<void>; children?: React.ReactNode;
}) {
  return (
    <li>
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{titulo}</span>
        <p className="muted small" style={{ margin: '2px 0 0' }}>{pie}</p>
      </div>
      <form action={accion} className="acciones" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="hidden" name="kind" value={kind} />
        {children}
        <button className="btn btn-primary" type="submit">Encargar</button>
      </form>
    </li>
  );
}

function Casilla({ name, etiqueta }: { name: string; etiqueta: string }) {
  return (
    <label className="small muted" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      <input type="checkbox" name={name} />{etiqueta}
    </label>
  );
}

/**
 * La etiqueta de estado.
 *
 * Reutiliza los colores de `sev` en vez de inventar una paleta: son los mismos
 * niveles de atención —esto duele, esto mira, esto está bien—. `running` tiene
 * el suyo porque es el único estado que cambia mientras se mira, y con el gris
 * de los demás una tarea viva y una terminada hace tres horas se leían igual.
 */
function Estado({ estado }: { estado: string }) {
  const severidad: Record<string, string> = {
    running: 'live', queued: 'warning', done: 'info', skipped: 'info',
    incomplete: 'warning', cancelled: 'warning', failed: 'error',
  };
  const texto: Record<string, string> = {
    running: 'en curso', queued: 'en cola', done: 'hecho', skipped: 'ya estaba',
    incomplete: 'incompleto', cancelled: 'parada', failed: 'falló',
  };
  return <span className={`sev sev-${severidad[estado] ?? 'info'}`}>{texto[estado] ?? estado}</span>;
}

function Fact({ k, v }: { k: string; v: string }) {
  return <li><span className="k">{k}</span><span>{v}</span></li>;
}

/**
 * Cuánto puede tardar un latido antes de que demos por ido al trabajador.
 *
 * Late cada 10 s; un minuto da margen para seis latidos perdidos, que es
 * bastante más de lo que cuesta un parpadeo de la red. El precio es el de
 * siempre y es el correcto: cerrar la ventana del trabajador tarda hasta un
 * minuto en verse aquí. **Equivocarse hacia «creo que sigue» durante un minuto
 * es mucho más barato que decir «no hay nadie» mientras trabaja.**
 */
const MARGEN_LATIDO_MS = 60_000;

/**
 * ¿Hay alguien escuchando?
 *
 * No hay columna de estado que leer, y es deliberado: **estar vivo no es un
 * estado que se escriba, es una fecha que envejece.** Un proceso que muere de
 * golpe no actualiza ningún `status`, que es exactamente cómo el panel del 28
 * de agosto dijo «va bien» durante catorce horas. Un `last_seen` no puede
 * mentir en esa dirección.
 */
function Trabajadores({ lista }: { lista: Trabajador[] }) {
  const vivos = lista.filter(
    (t) => Date.now() - new Date(t.last_seen).getTime() < MARGEN_LATIDO_MS,
  );

  const comoArrancarlo = (
    <>
      {' '}Para arrancarlo: doble clic en <code>trabajador.cmd</code>, en la máquina de
      casa, y dejar la ventana abierta.
    </>
  );

  if (vivos.length === 0) {
    const ultimo = lista[0];
    return (
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        <span className="sev sev-warning">nadie escuchando</span>{' '}
        {ultimo
          ? <>El último fue <strong>{ultimo.host}</strong>, {hace(ultimo.last_seen)}.</>
          : <>Ningún trabajador ha dado señales todavía.</>}
        {' '}Se puede encargar igual —la cola no pierde nada— pero no se hará hasta que
        haya uno.{comoArrancarlo}
      </p>
    );
  }

  return (
    <p className="muted small" style={{ margin: '8px 0 0' }}>
      <span className="sev sev-live">escuchando</span>{' '}
      {vivos.map((t) => (
        <span key={t.host}>
          <strong>{t.host}</strong>
          {t.job_id ? <> · ocupado con el encargo #{t.job_id}</> : <> · libre</>}
          {' '}(señal {hace(t.last_seen)})
        </span>
      ))}
      . Lo ejecuta esa máquina, no la web.
    </p>
  );
}

/** Las opciones con las que se pidió, en corto. */
function resumirArgs(args: Record<string, unknown>): string {
  const partes = Object.entries(args ?? {})
    .map(([k, v]) => (v === true ? k : `${k}=${v}`));
  return partes.length > 0 ? `· ${partes.join(' ')}` : '';
}

function ultimasLineas(texto: string, n: number): string {
  const lineas = texto.split('\n');
  return lineas.slice(-n).join('\n');
}

/**
 * Las cifras de un museo, sin los ceros: enseñar «0 publicadas, 0 esperando,
 * 0 rechazadas» en cada fila llenaría la pantalla de nada y escondería la línea
 * que importa.
 */
function cifras(lang: Lang, p: Step): string {
  const partes: string[] = [];
  const n = (v: number) => formatNumber(lang, v);

  if (p.status === 'skipped') return `ya estaba hecho · ${n(p.duplicated)} obras en el catálogo`;

  if (p.published) partes.push(`${n(p.published)} publicadas`);
  if (p.pending) partes.push(`${n(p.pending)} esperando datos`);
  if (p.rejected) partes.push(`${n(p.rejected)} no son obras`);
  if (p.duplicated) partes.push(`${n(p.duplicated)} duplicadas`);
  if (p.repaired) partes.push(`${n(p.repaired)} corregidas`);
  if (p.lost_works) partes.push(`${n(p.lost_works)} perdidas en ${n(p.lost_batches)} lotes`);
  if (p.retries) partes.push(`${n(p.retries)} reintentos`);

  return partes.length > 0 ? partes.join(' · ') : 'sin cifras todavía';
}

/** Hora local, corta. La fecha solo si no es de hoy. */
function cuando(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date().toDateString() === d.toDateString();
  return hoy
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function duracion(desde: string, hasta: string): string {
  return reloj((new Date(hasta).getTime() - new Date(desde).getTime()) / 1000);
}

function hace(iso: string): string {
  return `hace ${reloj((Date.now() - new Date(iso).getTime()) / 1000)}`;
}

function reloj(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
