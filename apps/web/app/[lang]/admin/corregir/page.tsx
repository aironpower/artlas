import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ q?: string }>;
}

/**
 * Encontrar lo que hay que corregir.
 *
 * Busca por título, por nombre de artista y por identificador —el número de la
 * ficha o el QID de Wikidata—, porque las tres son formas reales de llegar: se
 * llega desde la app pública con un id, desde Wikidata con un QID, y desde la
 * cabeza con un título a medias.
 *
 * Busca con la sesión del administrador, así que alcanza también lo que no está
 * publicado (política de 0021). Es justo lo que hay que poder corregir: lo que
 * ya se ve bien no suele necesitar arreglo.
 */
export default async function Corregir({ params, searchParams }: Props) {
  const { lang } = await params;
  const { q } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const busca = (q ?? '').trim();

  /*
   * Se busca con dos funciones de la base y no con `.ilike()` desde aquí. La
   * primera versión hacía lo segundo y estaba mal dos veces: tardaba 25-34 s
   * —el índice de títulos de `artworks` está sobre `immutable_unaccent(title)`
   * y además solo cubre las publicadas— y al pasarse de los 3 s de tiempo
   * máximo devolvía `null`, que esta pantalla pintaba como «no hay nada». Decir
   * «no existe» cuando lo que ha pasado es que la consulta se cayó hace perder
   * una tarde buscando una obra que estaba ahí.
   */
  const [obrasRes, artistasRes] = busca
    ? await Promise.all([
        db.rpc('admin_search_artworks', { p_q: busca }),
        db.rpc('admin_search_artists', { p_q: busca }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const obras = (obrasRes.data ?? []) as Record<string, unknown>[];
  const artistas = (artistasRes.data ?? []) as Record<string, unknown>[];
  const fallo = obrasRes.error?.message ?? artistasRes.error?.message ?? null;

  // Ni número ni QID: entonces se ha buscado por título, y eso tiene un límite.
  const porTitulo = Boolean(busca) && !/^\d+$/.test(busca) && !/^Q\d+$/i.test(busca);

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted"><Link href={path(idioma, 'admin')}>← Panel</Link></p>
        <h1>Corregir el catálogo</h1>
        <p className="muted small">
          Lo que corrijas a mano queda defendido: la ingesta no vuelve a pisarlo.
        </p>
      </header>

      <form className="search-form" style={{ maxWidth: 520, paddingTop: 8 }}>
        <input type="search" name="q" defaultValue={busca}
          placeholder="Título, artista, número de ficha o QID" />
        <button className="btn" type="submit">Buscar</button>
      </form>

      <p style={{ padding: '14px 0 0' }}>
        <Link className="btn" href={`${path(idioma, 'admin')}/corregir/obra/nueva`}>
          Crear una obra a mano
        </Link>
      </p>

      {fallo && (
        <p className="aviso aviso-mal" style={{ marginTop: 14 }}>
          La búsqueda falló: {fallo}. No quiere decir que no exista.
        </p>
      )}

      {!fallo && busca && obras.length === 0 && artistas.length === 0 && (
        <>
          <p className="empty" style={{ paddingBottom: 8 }}>Nada con «{busca}».</p>
          {porTitulo && (
            <p className="small muted" style={{ textAlign: 'center' }}>
              Por título no se llega a las obras que esperan datos: se guardan sin
              traducciones para ahorrar espacio. A esas se llega por su número de
              ficha o su QID de Wikidata.
            </p>
          )}
        </>
      )}

      {obras.length > 0 && (
        <section style={{ paddingTop: 26 }}>
          <h2>Obras</h2>
          <ul className="findings">
            {obras.map((o) => {
              const defendidos = ((o.locked_fields as string[] | null) ?? []).length
                + (o.status_locked ? 1 : 0);
              const artista = o.artist_name as string | null;

              return (
                <li key={o.id as number}>
                  <div>
                    <Link href={`${path(idioma, 'admin')}/corregir/obra/${o.id as number}`}>
                      {o.title as string}
                    </Link>
                    <p className="muted small" style={{ margin: '2px 0 0' }}>
                      #{o.id as number}
                      {artista && ` · ${artista}`}
                      {' · '}{o.status as string}
                      {o.wikidata_qid ? ` · ${o.wikidata_qid as string}` : ' · sin Wikidata'}
                      {defendidos > 0 && ` · ${defendidos} campo(s) defendido(s)`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {artistas.length > 0 && (
        <section style={{ paddingTop: 26 }}>
          <h2>Artistas</h2>
          <ul className="findings">
            {artistas.map((a) => (
              <li key={a.id as number}>
                <div>
                  <Link href={`${path(idioma, 'admin')}/corregir/artista/${a.id as number}`}>
                    {a.name as string}
                  </Link>
                  <p className="muted small" style={{ margin: '2px 0 0' }}>
                    #{a.id as number} · {formatNumber(idioma, (a.artwork_count as number) ?? 0)} obras
                    {((a.locked_fields as string[] | null) ?? []).length > 0 &&
                      ` · ${(a.locked_fields as string[]).length} campo(s) defendido(s)`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
