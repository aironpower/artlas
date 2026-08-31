import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, formatNumber, LANGS, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import Ficha from '../../Ficha';
import Traducciones from '../../Traducciones';
import {
  CAMPOS_MOVIMIENTO, CAMPOS_TRAD_MOVIMIENTO, soloLoCambiado, traduccionesCambiadas,
  type Traduccion,
} from '../../campos';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ error?: string; guardado?: string }>;
}

/**
 * Corregir un movimiento.
 *
 * Los nombres de movimiento llegan de Wikidata en minúscula y a veces en
 * inglés aunque exista el término en español —«academic art», «Venetian
 * school»—, así que la traducción es aquí tan importante como en los artistas:
 * es lo que se lee en el filtro y en la ficha de cada obra.
 *
 * Fusionar dos movimientos que son el mismo NO se hace desde aquí: eso es
 * `npm run merge-movements`, que además mueve las obras de uno a otro. Y no se
 * hace nunca con una ingesta viva — borrar un movimiento que un barrido tiene
 * en caché ya tumbó un museo entero.
 */
export default async function CorregirMovimiento({ params, searchParams }: Props) {
  const { lang, id } = await params;
  const { error, guardado } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const numero = Number(id);
  if (!Number.isInteger(numero)) notFound();

  const [{ data: movimiento }, { data: traducciones }] = await Promise.all([
    db.from('movements').select('*').eq('id', numero).single(),
    db.from('movement_translations').select('*').eq('movement_id', numero),
  ]);

  if (!movimiento) notFound();

  const defendidos = (movimiento.locked_fields as string[] | null) ?? [];
  const filas = (traducciones ?? []) as Traduccion[];

  async function guardar(formData: FormData) {
    'use server';

    const server = await supabaseServer();

    const [{ data: actual }, { data: actuales }] = await Promise.all([
      server.from('movements').select('*').eq('id', numero).single(),
      server.from('movement_translations').select('*').eq('movement_id', numero),
    ]);

    const cambios = soloLoCambiado(CAMPOS_MOVIMIENTO, formData, actual ?? {});
    const soltar = formData.getAll('soltar').map(String);

    const base = `${path(idioma, 'admin')}/corregir/movimiento/${numero}`;
    let fallo: string | null = null;

    if (Object.keys(cambios).length > 0 || soltar.length > 0) {
      const { error: err } = await server.rpc('editar_ficha', {
        p_tabla: 'movements', p_id: numero, p_cambios: cambios, p_soltar: soltar,
      });
      fallo = err?.message ?? null;
    }

    const porIdioma = traduccionesCambiadas(
      CAMPOS_TRAD_MOVIMIENTO, LANGS, formData, (actuales ?? []) as Traduccion[],
    );

    for (const t of porIdioma) {
      if (fallo) break;
      const { error: err } = await server.rpc('editar_traduccion', {
        p_entidad: 'movement', p_id: numero, p_lang: t.lang,
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
          <Link href={`${path(idioma, 'admin')}/catalogo/movimientos`}>← Los movimientos</Link>
        </p>
        <h1>{movimiento.name as string}</h1>
        <p className="muted small">
          #{movimiento.id as number}
          {movimiento.wikidata_qid ? ` · ${movimiento.wikidata_qid as string}` : ' · sin Wikidata'}
          {' · '}{formatNumber(idioma, (movimiento.artwork_count as number) ?? 0)} obras
          {' · '}
          <Link href={`${path(idioma, 'search')}?mov=${movimiento.slug as string}`}>
            ver sus obras
          </Link>
        </p>
      </header>

      {error && <p className="aviso aviso-mal">{error}</p>}
      {guardado && <p className="aviso aviso-bien">Guardado.</p>}

      <form action={guardar}>
        <Ficha campos={CAMPOS_MOVIMIENTO} valores={movimiento as Record<string, unknown>} defendidos={defendidos} />
        <Traducciones campos={CAMPOS_TRAD_MOVIMIENTO} filas={filas} />

        <div style={{ display: 'flex', gap: 10, padding: '18px 0 40px' }}>
          <button className="btn btn-primary" type="submit">Guardar los cambios</button>
          <Link className="btn" href={`${path(idioma, 'admin')}/catalogo/movimientos`}>Dejarlo</Link>
        </div>
      </form>
    </>
  );
}
