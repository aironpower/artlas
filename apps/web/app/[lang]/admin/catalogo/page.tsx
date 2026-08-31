import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import { cargarMuseos, porCiudad } from './datos';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ lang: string }> }

/**
 * El menú del catálogo: por dónde se entra a corregir.
 *
 * Hasta ahora al catálogo solo se llegaba buscando, y buscar exige saber ya lo
 * que se busca. Estas listas sirven para lo contrario: mirar lo que hay y
 * encontrar lo que está mal sin sospecharlo antes. Que 18 de los 30 museos
 * mayores tuvieran como ciudad un barrio no se descubrió buscando ninguno de
 * ellos, se descubrió mirando la lista entera de un vistazo.
 *
 * Obras y artistas no tienen lista completa —son 269.000 y 21.000— y por eso
 * siguen entrando por el buscador. Museos, ciudades y movimientos sí caben.
 */
export default async function Catalogo({ params }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const museos = await cargarMuseos(db, idioma);

  /*
   * Las obras NO llevan recuento, y no es un olvido. Exacto no se puede: un
   * `count(*)` sobre 269.000 filas se come los 3 s de tiempo máximo del rol.
   * Estimado tampoco: el planificador decía 172.776 el día que se escribió
   * esto, cien mil menos de las que hay, porque sus estadísticas envejecen
   * entre ingesta e ingesta. Un número que miente en un tercio es peor que no
   * poner ninguno; el del catálogo de verdad está en el panel, contado allí.
   */
  const [movimientos, artistas] = await Promise.all([
    db.from('movements').select('id', { count: 'exact', head: true }),
    db.from('artists').select('id', { count: 'exact', head: true }),
  ]);

  const ciudades = porCiudad(museos);

  const secciones: {
    href: string; titulo: string; cuantos: number | null; pie: string;
  }[] = [
    {
      href: `${path(idioma, 'admin')}/catalogo/museos`,
      titulo: 'Museos',
      cuantos: museos.length,
      pie: 'Nombre, ciudad, país y los textos de cada idioma.',
    },
    {
      href: `${path(idioma, 'admin')}/catalogo/ciudades`,
      titulo: 'Ciudades',
      cuantos: ciudades.length,
      pie: 'Wikidata da barrios y distritos. Aquí se arreglan de una vez para todos sus museos.',
    },
    {
      href: `${path(idioma, 'admin')}/catalogo/movimientos`,
      titulo: 'Movimientos',
      cuantos: movimientos.count ?? 0,
      pie: 'Llegan en inglés y en minúscula; se leen en el filtro y en cada ficha.',
    },
    {
      href: `${path(idioma, 'admin')}/catalogo/artistas`,
      titulo: 'Artistas',
      cuantos: artistas.count ?? 0,
      pie: 'De cien en cien, por número de obras. Al resto se llega buscando.',
    },
    {
      href: `${path(idioma, 'admin')}/corregir`,
      titulo: 'Obras',
      cuantos: null,
      pie: 'Demasiadas para una lista: se buscan por título, número de ficha o QID.',
    },
  ];

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted"><Link href={path(idioma, 'admin')}>← Panel</Link></p>
        <h1>El catálogo</h1>
        <p className="muted small">
          Mirar lo que hay y corregirlo a mano. Lo que corrijas queda defendido de la ingesta.
        </p>
      </header>

      <ul className="findings" style={{ paddingTop: 10 }}>
        {secciones.map((s) => (
          <li key={s.href}>
            <div>
              <Link href={s.href}>{s.titulo}</Link>
              {s.cuantos !== null && (
                <span className="muted"> · {formatNumber(idioma, s.cuantos)}</span>
              )}
              <p className="muted small" style={{ margin: '2px 0 0' }}>{s.pie}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
