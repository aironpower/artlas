import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ lang: string; rule: string }> }

/**
 * Los hallazgos de una regla concreta, con la obra a la que apuntan y los dos
 * botones que hacen útil una bandeja: confirmar y descartar.
 *
 * `dismissed` es el estado que importa. El auditor NUNCA reabre un hallazgo
 * descartado, así que descartarlo es lo que hace que la bandeja converja en
 * lugar de repetir los mismos falsos positivos en cada pasada.
 */
export default async function FindingsPage({ params }: Props) {
  const { lang, rule } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const { data: hallazgos } = await db
    .from('audit_findings')
    .select('id, entity_type, entity_id, severity, detail, status')
    .eq('rule', rule)
    .eq('status', 'open')
    .order('first_seen', { ascending: true })
    .limit(200);

  if (!hallazgos) notFound();

  /*
   * Los títulos aparte: `audit_findings` apunta a cuatro tablas distintas y no
   * tiene clave foránea, así que no se puede pedir con un join anidado.
   */
  const idsObra = hallazgos.filter((h) => h.entity_type === 'artwork').map((h) => h.entity_id);
  const { data: obras } = idsObra.length
    ? await db.from('artworks').select('id, title, status').in('id', idsObra)
    : { data: [] };
  const porId = new Map((obras ?? []).map((o) => [o.id, o]));

  async function revisar(formData: FormData) {
    'use server';

    const id = Number(formData.get('id'));
    const estado = String(formData.get('estado'));

    const server = await supabaseServer();

    /*
     * La comprobación de rol vive DENTRO de `review_finding`. Llamarla desde
     * aquí sin ser administrador devuelve un error de la base, no una escritura
     * silenciosa: la garantía no depende de que esta pantalla esté protegida.
     */
    await server.rpc('review_finding', { p_finding_id: id, p_status: estado });

    revalidatePath(`${path(idioma, 'admin')}/hallazgos/${rule}`);
  }

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted"><Link href={path(idioma, 'admin')}>← Panel</Link></p>
        <h1>{rule}</h1>
        <p className="muted">
          {formatNumber(idioma, hallazgos.length)} sin revisar
          {hallazgos.length === 200 && ' (se muestran los 200 más antiguos)'}
        </p>
      </header>

      {hallazgos.length === 0 ? (
        <p className="empty">Nada pendiente con esta regla.</p>
      ) : (
        <ul className="findings">
          {hallazgos.map((h) => {
            const obra = porId.get(h.entity_id);
            return (
              <li key={h.id}>
                <div>
                  <span className={`sev sev-${h.severity}`}>{h.severity}</span>
                  {obra ? (
                    <Link href={path(idioma, 'artwork', h.entity_id)}>{obra.title}</Link>
                  ) : (
                    <span className="muted">{h.entity_type} #{h.entity_id}</span>
                  )}
                  {obra && obra.status !== 'published' && (
                    <span className="muted small"> · {obra.status}</span>
                  )}
                  <p className="muted small" style={{ margin: '4px 0 0' }}>{h.detail}</p>
                </div>

                {/*
                  * El enlace que faltaba. La bandeja llevaba a la ficha
                  * PÚBLICA de la obra: se veía el problema y desde ahí no se
                  * podía hacer nada, había que ir al panel, buscarla otra vez y
                  * abrir su formulario. Una bandeja de revisión sin el botón de
                  * arreglar es una lista de quejas.
                  *
                  * Solo para las obras y artistas, que son los que tienen
                  * formulario por id; un hallazgo de movimiento apunta a otra
                  * tabla y su corrección se hace desde el catálogo.
                  */}
                <div className="acciones">
                  {(h.entity_type === 'artwork' || h.entity_type === 'artist') && (
                    <Link
                      className="btn"
                      href={`${path(idioma, 'admin')}/corregir/${h.entity_type === 'artwork' ? 'obra' : 'artista'}/${h.entity_id}`}
                    >
                      Corregir
                    </Link>
                  )}

                <form action={revisar} className="acciones">
                  <input type="hidden" name="id" value={h.id} />
                  <button className="btn" name="estado" value="confirmed" type="submit">
                    Es un problema
                  </button>
                  <button className="btn" name="estado" value="dismissed" type="submit">
                    Falso positivo
                  </button>
                </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="small muted" style={{ marginTop: 18 }}>
        Lo descartado no vuelve: el auditor no reabre un hallazgo marcado como falso
        positivo, aunque lo siga detectando.
      </p>
    </>
  );
}
