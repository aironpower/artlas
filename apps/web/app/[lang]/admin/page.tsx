import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';

/*
 * Nunca en caché: el panel enseña el estado del catálogo AHORA, y una bandeja
 * de revisión con datos de hace una hora es peor que no tenerla — se revisa
 * dos veces lo mismo o se da por hecho que algo sigue abierto.
 */
export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ lang: string }> }

export default async function AdminPage({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  // Si no es administrador, esta página no existe.
  const admin = await requireAdmin();
  const db = await supabaseServer();

  /*
   * Se consulta con la sesión del usuario, no con service_role: las políticas
   * de 0020 son las que deciden si devuelve algo. Un no-administrador que
   * llamara a esto por su cuenta se llevaría cero filas.
   */
  const [{ data: hallazgos }, { data: catalogo }] = await Promise.all([
    db.from('audit_findings')
      .select('rule, severity, status')
      .eq('status', 'open')
      .limit(5000),
    db.from('artworks').select('status').limit(200000),
  ]);

  const porRegla = new Map<string, { severity: string; n: number }>();
  for (const h of hallazgos ?? []) {
    const actual = porRegla.get(h.rule);
    if (actual) actual.n++;
    else porRegla.set(h.rule, { severity: h.severity, n: 1 });
  }

  const porEstado = new Map<string, number>();
  for (const a of catalogo ?? []) porEstado.set(a.status, (porEstado.get(a.status) ?? 0) + 1);

  const orden: Record<string, number> = { error: 0, warning: 1, info: 2 };
  const filas = [...porRegla.entries()]
    .sort((a, b) => (orden[a[1].severity]! - orden[b[1].severity]!) || b[1].n - a[1].n);

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>Panel de revisión</h1>
        <p className="muted small">{admin.email}</p>
      </header>

      <section>
        <h2>La ingesta</h2>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          <Link href={`${path(lang, 'admin')}/ingesta`}>Ver cómo va</Link>
          {' · '}en qué museo está, qué terminó y qué falló.
        </p>
      </section>

      <section style={{ paddingTop: 26 }}>
        <h2>El catálogo</h2>
        <ul className="facts">
          <Fact k="Publicadas" v={formatNumber(lang, porEstado.get('published') ?? 0)} />
          <Fact k="Esperando datos" v={formatNumber(lang, porEstado.get('pending') ?? 0)} />
          <Fact k="No son obras" v={formatNumber(lang, porEstado.get('rejected') ?? 0)} />
        </ul>
      </section>

      <section style={{ paddingTop: 26 }}>
        <h2>Hallazgos sin revisar</h2>

        {filas.length === 0 ? (
          <p className="empty">Nada pendiente de revisar.</p>
        ) : (
          <ul className="facts">
            {filas.map(([rule, info]) => (
              <li key={rule}>
                <span className="k">
                  <span className={`sev sev-${info.severity}`}>{info.severity}</span>
                </span>
                <span>
                  <Link href={`${path(lang, 'admin')}/hallazgos/${rule}`}>{rule}</Link>
                  <span className="muted"> · {formatNumber(lang, info.n)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="small muted" style={{ marginTop: 14 }}>
          Los hallazgos los genera <code>npm run audit</code>. Esta pantalla es de solo
          lectura: descartar y confirmar llegarán con sus propias políticas de escritura.
        </p>
      </section>
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <li><span className="k">{k}</span><span>{v}</span></li>;
}
