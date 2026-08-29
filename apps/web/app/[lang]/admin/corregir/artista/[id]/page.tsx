import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import Ficha from '../../Ficha';
import { CAMPOS_ARTISTA, soloLoCambiado } from '../../campos';

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

  const { data: artista } = await db.from('artists').select('*').eq('id', numero).single();
  if (!artista) notFound();

  const defendidos = (artista.locked_fields as string[] | null) ?? [];

  async function guardar(formData: FormData) {
    'use server';

    const server = await supabaseServer();
    const soltar = formData.getAll('soltar').map(String);

    // Se relee: entre pintar y guardar puede haber pasado una ingesta entera.
    const { data: actual } = await server.from('artists').select('*').eq('id', numero).single();
    const cambios = soloLoCambiado(CAMPOS_ARTISTA, formData, actual ?? {});

    const { error: err } = await server.rpc('edit_artist', {
      p_id: numero, p_cambios: cambios, p_soltar: soltar,
    });

    const base = `${path(idioma, 'admin')}/corregir/artista/${numero}`;
    redirect(err ? `${base}?error=${encodeURIComponent(err.message)}` : `${base}?guardado=1`);
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

        <div style={{ display: 'flex', gap: 10, padding: '18px 0 40px' }}>
          <button className="btn btn-primary" type="submit">Guardar los cambios</button>
          <Link className="btn" href={`${path(idioma, 'admin')}/corregir`}>Dejarlo</Link>
        </div>
      </form>
    </>
  );
}
