import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import { cargarMuseos } from '../datos';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ lang: string }> }

/**
 * Los 48 museos, de más obras a menos.
 *
 * Se enseña la ciudad CANÓNICA y, si difiere, la traducida debajo: son dos
 * datos distintos —el filtro público enseña una y filtra por la otra (0032)—
 * y verlos juntos es lo que deja ver que el Louvre está en un barrio y no en
 * París.
 */
export default async function Museos({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const museos = await cargarMuseos(db, idioma);

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted">
          <Link href={`${path(idioma, 'admin')}/catalogo`}>← El catálogo</Link>
        </p>
        <h1>Museos</h1>
        <p className="muted small">
          {formatNumber(idioma, museos.length)} en total. Ordenados por obras en el catálogo.
        </p>
      </header>

      <ul className="findings">
        {museos.map((m) => {
          const defendidos = (m.locked_fields ?? []).length;

          return (
            <li key={m.id}>
              <div>
                <Link href={`${path(idioma, 'admin')}/corregir/museo/${m.id}`}>
                  {m.nombre_es ?? m.name}
                </Link>
                <p className="muted small" style={{ margin: '2px 0 0' }}>
                  {m.city ?? 'sin ciudad'}
                  {m.ciudad_es && m.ciudad_es !== m.city && ` («${m.ciudad_es}» en ${idioma})`}
                  {m.country && ` · ${m.country}`}
                  {' · '}{formatNumber(idioma, m.artwork_count)} obras
                  {defendidos > 0 && ` · ${defendidos} campo(s) defendido(s)`}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="small muted" style={{ padding: '20px 0 40px' }}>
        Un museo no se crea a mano: entra con su primera obra. Y si varios comparten
        una ciudad mal puesta, sale mejor arreglarla desde{' '}
        <Link href={`${path(idioma, 'admin')}/catalogo/ciudades`}>las ciudades</Link>.
      </p>
    </>
  );
}
