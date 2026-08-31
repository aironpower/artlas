import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, LANGS, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import Ficha from '../../Ficha';
import Traducciones from '../../Traducciones';
import {
  CAMPOS_ARTISTA, CAMPOS_TRAD_ARTISTA, soloLoCambiado, traduccionesCambiadas,
  type Traduccion,
} from '../../campos';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ error?: string; guardado?: string }>;
}

/**
 * Corregir un artista.
 *
 * Sin creación a mano, y no por falta de ganas: un artista sin obras no se ve
 * en ninguna parte de la app, así que crearlo suelto sería fabricar una ficha
 * huérfana. Los artistas entran cuando entra una obra suya.
 *
 * El nombre de arriba es el CANÓNICO y no es el que lee un visitante: la app
 * pinta la traducción de su idioma si la hay. «Hieronymus Bosch» se llama «El
 * Bosco» en español, y eso se corrige en el bloque de idiomas de más abajo, no
 * aquí.
 */
export default async function CorregirArtista({ params, searchParams }: Props) {
  const { lang, id } = await params;
  const { error, guardado } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const numero = Number(id);
  if (!Number.isInteger(numero)) notFound();

  const [{ data: artista }, { data: traducciones }] = await Promise.all([
    db.from('artists').select('*').eq('id', numero).single(),
    db.from('artist_translations').select('*').eq('artist_id', numero),
  ]);

  if (!artista) notFound();

  const defendidos = (artista.locked_fields as string[] | null) ?? [];
  const filas = (traducciones ?? []) as Traduccion[];

  async function guardar(formData: FormData) {
    'use server';

    const server = await supabaseServer();
    const soltar = formData.getAll('soltar').map(String);

    // Se relee: entre pintar y guardar puede haber pasado una ingesta entera.
    const [{ data: actual }, { data: actuales }] = await Promise.all([
      server.from('artists').select('*').eq('id', numero).single(),
      server.from('artist_translations').select('*').eq('artist_id', numero),
    ]);

    const cambios = soloLoCambiado(CAMPOS_ARTISTA, formData, actual ?? {});

    const base = `${path(idioma, 'admin')}/corregir/artista/${numero}`;
    let fallo: string | null = null;

    if (Object.keys(cambios).length > 0 || soltar.length > 0) {
      const { error: err } = await server.rpc('edit_artist', {
        p_id: numero, p_cambios: cambios, p_soltar: soltar,
      });
      fallo = err?.message ?? null;
    }

    const porIdioma = traduccionesCambiadas(
      CAMPOS_TRAD_ARTISTA, LANGS, formData, (actuales ?? []) as Traduccion[],
    );

    for (const t of porIdioma) {
      if (fallo) break;
      const { error: err } = await server.rpc('editar_traduccion', {
        p_entidad: 'artist', p_id: numero, p_lang: t.lang,
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
          <Link href={`${path(idioma, 'admin')}/corregir`}>← Corregir el catálogo</Link>
        </p>
        <h1>{artista.name as string}</h1>
        <p className="muted small">
          #{artista.id as number}
          {artista.wikidata_qid ? ` · ${artista.wikidata_qid as string}` : ' · sin Wikidata'}
          {' · '}{formatNumber(idioma, (artista.artwork_count as number) ?? 0)} obras
          {' · '}<Link href={path(idioma, 'artist', artista.slug as string)}>ver la ficha pública</Link>
        </p>
      </header>

      {error && <p className="aviso aviso-mal">{error}</p>}
      {guardado && <p className="aviso aviso-bien">Guardado.</p>}

      <form action={guardar}>
        <Ficha
          campos={CAMPOS_ARTISTA}
          valores={artista as Record<string, unknown>}
          defendidos={defendidos}
        />
        <Traducciones campos={CAMPOS_TRAD_ARTISTA} filas={filas} />

        <div style={{ display: 'flex', gap: 10, padding: '18px 0 40px' }}>
          <button className="btn btn-primary" type="submit">Guardar los cambios</button>
          <Link className="btn" href={`${path(idioma, 'admin')}/corregir`}>Dejarlo</Link>
        </div>
      </form>
    </>
  );
}
