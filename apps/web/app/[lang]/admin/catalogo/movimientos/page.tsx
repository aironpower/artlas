import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ lang: string }> }

/**
 * Los movimientos, de más obras a menos.
 *
 * Los 224 caben en una página. Y conviene verlos juntos: es así como se ven los
 * que en realidad son el mismo con dos nombres —«Italian Renaissance» y «High
 * Renaissance», «Post-impressionism» y «postimpresionismo»—. Fusionarlos no se
 * hace desde aquí (es `npm run merge-movements`, que además mueve las obras),
 * pero encontrarlos sí empieza aquí.
 */
export default async function Movimientos({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const { data } = await db
    .from('movements')
    .select('id, name, slug, artwork_count, locked_fields, movement_translations ( lang, name )')
    .order('artwork_count', { ascending: false });

  const movimientos = (data ?? []) as Record<string, unknown>[];

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted">
          <Link href={`${path(idioma, 'admin')}/catalogo`}>← El catálogo</Link>
        </p>
        <h1>Movimientos</h1>
        <p className="muted small">
          {formatNumber(idioma, movimientos.length)} en total. Los que no tienen obras
          entraron con una obra que luego se quedó esperando datos.
        </p>
      </header>

      <ul className="findings">
        {movimientos.map((m) => {
          const trads = (m.movement_translations ?? []) as { lang: string; name: string }[];
          const mio = trads.find((t) => t.lang === idioma)?.name;
          const defendidos = ((m.locked_fields as string[] | null) ?? []).length;

          return (
            <li key={m.id as number}>
              <div>
                <Link href={`${path(idioma, 'admin')}/corregir/movimiento/${m.id as number}`}>
                  {mio ?? (m.name as string)}
                </Link>
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  {formatNumber(idioma, (m.artwork_count as number) ?? 0)} obras
                  {mio && mio !== m.name && ` · «${m.name as string}» sin traducir`}
                  {!mio && ' · sin traducción'}
                  {defendidos > 0 && ` · ${defendidos} campo(s) defendido(s)`}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div style={{ padding: '0 0 40px' }} />
    </>
  );
}
