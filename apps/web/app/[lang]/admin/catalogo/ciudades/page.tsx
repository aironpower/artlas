import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, LANGS, LANG_NAMES, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import { cargarMuseos, porCiudad } from '../datos';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ ciudad?: string; pais?: string; error?: string; hechos?: string }>;
}

/**
 * Las ciudades del catálogo, y cómo se arregla una.
 *
 * Esta pantalla existe porque el fallo no es de un museo suelto. `wdt:P131` de
 * Wikidata da la entidad administrativa INMEDIATA, así que el catálogo cree que
 * el Louvre está en Saint-Germain-l'Auxerrois, el MNAC en Montjuïc y cuatro
 * museos de Londres en «City of Westminster». Arreglarlos museo a museo es la
 * clase de tarea en la que uno se queda a medias, y entonces el filtro público
 * ofrece «Londres» y «Ciudad de Westminster» como si fueran sitios distintos.
 *
 * Por eso el formulario cambia la ciudad de TODOS los museos que la comparten,
 * y por eso pide el nombre en cada idioma: la app enseña el traducido pero
 * filtra por el canónico, así que son dos datos y hay que poner los dos.
 */
export default async function Ciudades({ params, searchParams }: Props) {
  const { lang } = await params;
  const { ciudad, pais, error, hechos } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const museos = await cargarMuseos(db, idioma);
  const ciudades = porCiudad(museos);

  const elegida = ciudad
    ? ciudades.find((c) => c.ciudad === ciudad && (c.codigo ?? '??') === (pais ?? '??'))
    : undefined;

  // Los nombres que hoy tienen sus museos en cada idioma, para no pedir a
  // ciegas algo que quizá ya está bien puesto en francés.
  const actuales: Record<string, string[]> = {};

  if (elegida) {
    const { data } = await db
      .from('institution_translations')
      .select('lang, city')
      .in('institution_id', elegida.museos.map((m) => m.id));

    for (const fila of (data ?? []) as { lang: string; city: string | null }[]) {
      if (!fila.city) continue;
      const vistos = actuales[fila.lang] ?? [];
      if (!vistos.includes(fila.city)) vistos.push(fila.city);
      actuales[fila.lang] = vistos;
    }
  }

  async function renombrar(formData: FormData) {
    'use server';

    const server = await supabaseServer();

    const nueva = String(formData.get('nueva') ?? '').trim();
    const porIdioma: Record<string, string> = {};

    for (const l of LANGS) {
      const valor = String(formData.get(`ciudad.${l}`) ?? '').trim();
      if (valor) porIdioma[l] = valor;
    }

    const base = `${path(idioma, 'admin')}/catalogo/ciudades`;

    const { data, error: err } = await server.rpc('renombrar_ciudad', {
      p_pais: pais ?? null,
      p_ciudad: ciudad,
      p_nueva: nueva,
      p_por_idioma: porIdioma,
    });

    redirect(err
      ? `${base}?ciudad=${encodeURIComponent(ciudad!)}&pais=${pais ?? ''}&error=${encodeURIComponent(err.message)}`
      : `${base}?hechos=${data ?? 0}`);
  }

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted">
          <Link href={`${path(idioma, 'admin')}/catalogo`}>← El catálogo</Link>
        </p>
        <h1>Ciudades</h1>
        <p className="muted small">
          {formatNumber(idioma, ciudades.length)} ciudades con museos. Renombrar una las
          cambia en todos sus museos a la vez.
        </p>
      </header>

      {error && <p className="aviso aviso-mal">{error}</p>}
      {hechos && (
        <p className="aviso aviso-bien">
          Ciudad cambiada en {hechos} {Number(hechos) === 1 ? 'museo' : 'museos'}.
        </p>
      )}

      {elegida && (
        <section style={{ paddingTop: 20 }}>
          <h2>«{elegida.ciudad}» → …</h2>
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            Afecta a {elegida.museos.map((m) => m.nombre_es ?? m.name).join(', ')}.
          </p>

          <form action={renombrar}>
            <div className="ficha">
              <div className="ficha-campo ancho-medio">
                <label htmlFor="nueva">Ciudad (nombre canónico)</label>
                <input id="nueva" name="nueva" defaultValue={elegida.ciudad} required />
                <p className="pie">
                  El que no cambia con el idioma. Es por el que filtra la app: «Paris», no «París».
                </p>
              </div>

              {LANGS.map((l) => (
                <div key={l} className="ficha-campo ancho-medio">
                  <label htmlFor={`ciudad.${l}`}>Cómo se dice en {LANG_NAMES[l]}</label>
                  <input
                    id={`ciudad.${l}`}
                    name={`ciudad.${l}`}
                    defaultValue={(actuales[l] ?? []).length === 1 ? actuales[l]![0] : ''}
                    placeholder={(actuales[l] ?? []).join(' / ') || '—'}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '18px 0 10px' }}>
              <button className="btn btn-primary" type="submit">Cambiarla en sus museos</button>
              <Link className="btn" href={`${path(idioma, 'admin')}/catalogo/ciudades`}>Dejarlo</Link>
            </div>
          </form>

          <p className="small muted" style={{ paddingBottom: 20 }}>
            Un idioma que dejes en blanco se queda como está: en blanco no significa borrar.
          </p>
        </section>
      )}

      <ul className="findings">
        {ciudades.map((c) => (
          <li key={`${c.codigo}|${c.ciudad}`}>
            <div>
              <Link href={`${path(idioma, 'admin')}/catalogo/ciudades?ciudad=${encodeURIComponent(c.ciudad)}&pais=${c.codigo ?? ''}`}>
                {c.ciudad}
              </Link>
              <span className="muted"> · {c.pais ?? 'sin país'}</span>
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                {c.museos.length === 1 ? '1 museo' : `${c.museos.length} museos`}
                {' · '}{formatNumber(idioma, c.obras)} obras
                {' · '}{c.museos.map((m) => m.nombre_es ?? m.name).join(', ')}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="small muted" style={{ padding: '20px 0 40px' }}>
        La ciudad de un museo suelto también se puede corregir en su ficha. Esto es para
        cuando la comparten varios.
      </p>
    </>
  );
}
