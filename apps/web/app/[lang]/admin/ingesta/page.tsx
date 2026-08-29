import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import AutoRefresh from '@/components/AutoRefresh';

/*
 * Nunca en caché, y aquí no es una preferencia: la pantalla existe para
 * responder «¿en qué va AHORA?». Una versión de hace un minuto contestaría a
 * otra pregunta.
 */
export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ lang: string }> }

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
 * La ingesta, en vivo.
 *
 * Sustituye a leer `ingesta.log` con `tail`. El caso que la justifica: el
 * barrido del 28 de agosto de 2026 dejó 6.546 líneas de log, Filadelfia agotó
 * sus reintentos y murió a las 19:17, y se supo catorce horas después. Aquí
 * eso se ve en la primera pantalla y sin preguntarle a nadie.
 */
export default async function IngestaPage({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  /*
   * Enterrar a los muertos ANTES de leer.
   *
   * Un proceso que se cae de golpe deja su fila diciendo `running` para
   * siempre. Sin esta llamada, esta pantalla enseñaría «en curso» con la misma
   * cara de tranquilidad que tenía el log del 28 —que es exactamente el fallo
   * que vino a arreglar—. `reap_dead_runs()` cierra lo que lleve diez minutos
   * sin latir y escribe el motivo.
   */
  await db.rpc('reap_dead_runs');

  const { data: runs } = await db
    .from('ingest_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(12);

  const ejecuciones = (runs ?? []) as Run[];
  const actual = ejecuciones[0];

  const { data: steps } = actual
    ? await db.from('ingest_steps').select('*').eq('run_id', actual.id).order('position')
    : { data: [] };

  const pasos = (steps ?? []) as Step[];
  const viva = actual?.status === 'running';

  async function parar(formData: FormData) {
    'use server';

    const id = Number(formData.get('run'));
    const server = await supabaseServer();

    /*
     * La comprobación de rol vive DENTRO de `request_ingest_cancel`. Que esta
     * página esté protegida es comodidad; la garantía es que la función
     * rechaza a quien no es administrador aunque la llame por su cuenta.
     */
    await server.rpc('request_ingest_cancel', { p_run_id: id });
    revalidatePath(`${path(idioma, 'admin')}/ingesta`);
  }

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted"><Link href={path(idioma, 'admin')}>← Panel</Link></p>
        <h1>La ingesta</h1>
        <AutoRefresh activo={viva} />
      </header>

      {!actual ? (
        <p className="empty">
          Todavía no se ha registrado ninguna ejecución.
        </p>
      ) : (
        <>
          <section>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Estado estado={actual.status} />
              <span>Ejecución #{actual.id}</span>
            </h2>

            {actual.error && (
              <p style={{ color: 'var(--accent)', margin: '10px 0 0' }}>{actual.error}</p>
            )}

            {actual.cancel_requested && viva && (
              <p className="muted" style={{ margin: '10px 0 0' }}>
                Parada pedida. Sale al terminar el museo que tiene entre manos: cortarlo
                a la mitad lo dejaría sin checkpoint y habría que rehacerlo entero.
              </p>
            )}

            <ul className="facts">
              <Fact k="Museos" v={
                `${formatNumber(idioma, actual.museums_done)} de ` +
                `${formatNumber(idioma, actual.museums_total ?? 0)}`
              } />
              <Fact k="Empezó" v={cuando(actual.started_at)} />
              <Fact k={viva ? 'Lleva' : 'Duró'} v={
                duracion(actual.started_at, actual.finished_at ?? new Date().toISOString())
              } />
              {viva && <Fact k="Última señal" v={hace(actual.heartbeat_at)} />}
              <Fact k="Escritas" v={formatNumber(idioma, actual.stats.inserted ?? 0)} />
              {(actual.stats.lostWorks ?? 0) > 0 && (
                <Fact k="Obras perdidas" v={formatNumber(idioma, actual.stats.lostWorks!)} />
              )}
              {(actual.stats.retries ?? 0) > 0 && (
                <Fact k="Reintentos" v={formatNumber(idioma, actual.stats.retries!)} />
              )}
              <Fact k="Lanzada con" v={actual.command || '(sin opciones)'} />
              <Fact k="Dónde" v={`${actual.host ?? '?'} · pid ${actual.pid ?? '?'}`} />
            </ul>

            {viva && !actual.cancel_requested && (
              <form action={parar} style={{ marginTop: 16 }}>
                <input type="hidden" name="run" value={actual.id} />
                <button className="btn" type="submit">Parar al acabar este museo</button>
              </form>
            )}
          </section>

          <section style={{ paddingTop: 26 }}>
            <h2>Museo por museo</h2>

            {pasos.length === 0 ? (
              <p className="muted small" style={{ marginTop: 12 }}>
                Aún no ha empezado ninguno.
              </p>
            ) : (
              <ul className="findings">
                {[...pasos].reverse().map((p) => (
                  <li key={p.id}>
                    <div>
                      <Estado estado={p.status} />
                      <span style={{ marginLeft: 8 }}>{p.museum_name}</span>
                      <span className="muted small"> · {p.museum_qid}</span>

                      <p className="muted small" style={{ margin: '4px 0 0' }}>
                        {cifras(idioma, p)}
                      </p>

                      {p.error && (
                        <p className="small" style={{ margin: '4px 0 0', color: 'var(--accent)' }}>
                          {p.error}
                        </p>
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
        </>
      )}

      {ejecuciones.length > 1 && (
        <section style={{ paddingTop: 26 }}>
          <h2>Antes</h2>
          <ul className="facts">
            {ejecuciones.slice(1).map((r) => (
              <li key={r.id}>
                <span className="k"><Estado estado={r.status} /></span>
                <span>
                  #{r.id} · {cuando(r.started_at)}
                  <span className="muted">
                    {' · '}{formatNumber(idioma, r.stats.inserted ?? 0)} escritas
                    {' · '}{formatNumber(idioma, r.museums_done)} museo(s)
                  </span>
                  {r.error && <p className="muted small" style={{ margin: '2px 0 0' }}>{r.error}</p>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="small muted" style={{ marginTop: 20 }}>
        El detalle sigue estando en <code>ingesta.log</code>. Aquí vive el estado: en qué
        va, qué terminó con qué números y qué falló.
      </p>
    </>
  );
}

/**
 * La etiqueta de estado.
 *
 * Reutiliza los tres colores de `sev` en vez de inventar una paleta nueva: son
 * los mismos tres niveles de atención —esto duele, esto mira, esto está bien— y
 * el panel ya se lee así.
 */
function Estado({ estado }: { estado: string }) {
  const severidad: Record<string, string> = {
    running: 'live',
    done: 'info',
    skipped: 'info',
    incomplete: 'warning',
    cancelled: 'warning',
    failed: 'error',
  };

  const texto: Record<string, string> = {
    running: 'en curso',
    done: 'hecho',
    skipped: 'ya estaba',
    incomplete: 'incompleto',
    cancelled: 'parada',
    failed: 'falló',
  };

  return (
    <span className={`sev sev-${severidad[estado] ?? 'info'}`}>{texto[estado] ?? estado}</span>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <li><span className="k">{k}</span><span>{v}</span></li>;
}

/**
 * Las cifras de un museo, sin los ceros.
 *
 * Enseñar «0 publicadas, 0 esperando, 0 rechazadas, 0 duplicadas» en cada fila
 * llenaría la pantalla de nada y escondería la línea que sí importa.
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
