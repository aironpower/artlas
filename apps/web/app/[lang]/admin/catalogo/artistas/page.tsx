import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

const POR_PAGINA = 100;

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ p?: string }>;
}

/**
 * Los artistas con más obras.
 *
 * Son 21.619: una lista completa no es una lista, es otro catálogo. Se enseñan
 * de cien en cien ordenados por obras, que es el orden en el que importa
 * corregirlos —un nombre mal puesto en el que tiene 41 obras se ve 41 veces—.
 * Al resto se llega por el buscador, que además encuentra por QID.
 *
 * Se pagina con `range()` y no trayéndolos todos: 21.000 filas por la red para
 * enseñar cien es justo la clase de derroche que luego agota el tiempo máximo
 * del rol.
 */
export default async function Artistas({ params, searchParams }: Props) {
  const { lang } = await params;
  const { p } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const pagina = Math.max(1, Number(p) || 1);
  const desde = (pagina - 1) * POR_PAGINA;

  const { data } = await db
    .from('artists')
    .select('id, name, artwork_count, locked_fields, artist_translations ( lang, name )')
    .order('artwork_count', { ascending: false })
    .order('id', { ascending: true })
    .range(desde, desde + POR_PAGINA - 1);

  const artistas = (data ?? []) as Record<string, unknown>[];
  const base = `${path(idioma, 'admin')}/catalogo/artistas`;

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted">
          <Link href={`${path(idioma, 'admin')}/catalogo`}>← El catálogo</Link>
        </p>
        <h1>Artistas</h1>
        <p className="muted small">
          Por número de obras. Página {formatNumber(idioma, pagina)}.
        </p>
      </header>

      <form className="search-form" style={{ maxWidth: 520, paddingTop: 8 }}
            action={`${path(idioma, 'admin')}/corregir`}>
        <input type="search" name="q" placeholder="Buscar un artista por nombre o QID" />
        <button className="btn" type="submit">Buscar</button>
      </form>

      <ul className="findings">
        {artistas.map((a) => {
          const trads = (a.artist_translations ?? []) as { lang: string; name: string }[];
          const mio = trads.find((t) => t.lang === idioma)?.name;
          const defendidos = ((a.locked_fields as string[] | null) ?? []).length;

          return (
            <li key={a.id as number}>
              <div>
                <Link href={`${path(idioma, 'admin')}/corregir/artista/${a.id as number}`}>
                  {mio ?? (a.name as string)}
                </Link>
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  {formatNumber(idioma, (a.artwork_count as number) ?? 0)} obras
                  {mio && mio !== a.name && ` · «${a.name as string}» en la ficha canónica`}
                  {defendidos > 0 && ` · ${defendidos} campo(s) defendido(s)`}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div style={{ display: 'flex', gap: 10, padding: '20px 0 40px' }}>
        {pagina > 1 && <Link className="btn" href={`${base}?p=${pagina - 1}`}>Anterior</Link>}
        {artistas.length === POR_PAGINA && (
          <Link className="btn" href={`${base}?p=${pagina + 1}`}>Siguiente</Link>
        )}
      </div>
    </>
  );
}
