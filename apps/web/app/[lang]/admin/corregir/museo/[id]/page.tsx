import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, LANGS, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import Ficha from '../../Ficha';
import Traducciones from '../../Traducciones';
import {
  CAMPOS_MUSEO, CAMPOS_TRAD_MUSEO, soloLoCambiado, traduccionesCambiadas,
  type Traduccion,
} from '../../campos';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ error?: string; guardado?: string }>;
}

/**
 * Corregir un museo.
 *
 * Sin creación a mano y por el mismo motivo que los artistas: un museo sin
 * obras no aparece en ninguna parte de la app. Los museos entran con su
 * primera obra.
 *
 * La ciudad es el campo por el que existe esta pantalla. Wikidata da `P131`, la
 * entidad administrativa inmediata, que en el Louvre es el barrio de
 * Saint-Germain-l'Auxerrois y en el MNAC es Montjuïc. Si el museo comparte
 * ciudad mal puesta con otros —«City of Westminster» son cuatro museos de
 * Londres—, sale más a cuenta arreglarla desde la lista de ciudades, que los
 * cambia todos de una vez.
 */
export default async function CorregirMuseo({ params, searchParams }: Props) {
  const { lang, id } = await params;
  const { error, guardado } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const numero = Number(id);
  if (!Number.isInteger(numero)) notFound();

  const [{ data: museo }, { data: traducciones }] = await Promise.all([
    db.from('institutions').select('*').eq('id', numero).single(),
    db.from('institution_translations').select('*').eq('institution_id', numero),
  ]);

  if (!museo) notFound();

  const defendidos = (museo.locked_fields as string[] | null) ?? [];
  const filas = (traducciones ?? []) as Traduccion[];

  async function guardar(formData: FormData) {
    'use server';

    const server = await supabaseServer();

    // Se relee: entre pintar el formulario y guardarlo puede haber pasado una
    // ingesta entera, y lo que hay que comparar es contra lo que hay AHORA.
    const [{ data: actual }, { data: actuales }] = await Promise.all([
      server.from('institutions').select('*').eq('id', numero).single(),
      server.from('institution_translations').select('*').eq('institution_id', numero),
    ]);

    const cambios = soloLoCambiado(CAMPOS_MUSEO, formData, actual ?? {});
    const soltar = formData.getAll('soltar').map(String);

    const base = `${path(idioma, 'admin')}/corregir/museo/${numero}`;
    let fallo: string | null = null;

    if (Object.keys(cambios).length > 0 || soltar.length > 0) {
      const { error: err } = await server.rpc('editar_ficha', {
        p_tabla: 'institutions', p_id: numero, p_cambios: cambios, p_soltar: soltar,
      });
      fallo = err?.message ?? null;
    }

    const porIdioma = traduccionesCambiadas(
      CAMPOS_TRAD_MUSEO, LANGS, formData, (actuales ?? []) as Traduccion[],
    );

    for (const t of porIdioma) {
      if (fallo) break;
      const { error: err } = await server.rpc('editar_traduccion', {
        p_entidad: 'institution', p_id: numero, p_lang: t.lang,
        p_cambios: t.cambios, p_soltar: t.soltar,
      });
      fallo = err?.message ?? null;
    }

    redirect(fallo ? `${base}?error=${encodeURIComponent(fallo)}` : `${base}?guardado=1`);
  }

  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <p className="small muted">
          <Link href={`${path(idioma, 'admin')}/catalogo/museos`}>← Los museos</Link>
        </p>
        <h1>{museo.name as string}</h1>
        <p className="muted small">
          #{museo.id as number}
          {museo.wikidata_qid ? ` · ${museo.wikidata_qid as string}` : ' · sin Wikidata'}
          {' · '}{formatNumber(idioma, (museo.artwork_count as number) ?? 0)} obras
          {' · '}<Link href={path(idioma, 'museum', museo.slug as string)}>ver la ficha pública</Link>
        </p>
      </header>

      {error && <p className="aviso aviso-mal">{error}</p>}
      {guardado && <p className="aviso aviso-bien">Guardado.</p>}

      <form action={guardar}>
        <Ficha campos={CAMPOS_MUSEO} valores={museo as Record<string, unknown>} defendidos={defendidos} />
        <Traducciones campos={CAMPOS_TRAD_MUSEO} filas={filas} />

        <div style={{ display: 'flex', gap: 10, padding: '18px 0 40px' }}>
          <button className="btn btn-primary" type="submit">Guardar los cambios</button>
          <Link className="btn" href={`${path(idioma, 'admin')}/catalogo/museos`}>Dejarlo</Link>
        </div>
      </form>
    </>
  );
}
