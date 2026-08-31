import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { isLang, LANGS, type Lang } from '@/lib/i18n';
import { requireAdmin, supabaseServer } from '@/lib/auth';
import { path } from '@/lib/routes';
import Ficha from '../../Ficha';
import Traducciones from '../../Traducciones';
import {
  CAMPOS_OBRA, CAMPOS_TRAD_OBRA, soloLoCambiado, traduccionesCambiadas,
  type Traduccion,
} from '../../campos';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ error?: string; guardado?: string }>;
}

/**
 * Corregir una obra, o crear una que no está en ninguna fuente.
 *
 * La misma pantalla para las dos cosas —`/corregir/obra/nueva` crea— porque el
 * formulario es idéntico y tener dos copias es tener una que se queda vieja.
 *
 * La regla que gobierna esto, y que conviene no olvidar al tocarla: **solo se
 * guarda lo que de verdad ha cambiado**, y lo que cambia queda defendido de la
 * ingesta. Si se enviaran los diecisiete campos, abrir el formulario y darle a
 * guardar congelaría la ficha entera frente a Wikidata.
 */
export default async function CorregirObra({ params, searchParams }: Props) {
  const { lang, id } = await params;
  const { error, guardado } = await searchParams;
  if (!isLang(lang)) notFound();

  const idioma: Lang = lang;
  await requireAdmin();
  const db = await supabaseServer();

  const creando = id === 'nueva';
  const numero = creando ? null : Number(id);

  if (!creando && !Number.isInteger(numero)) notFound();

  const { data: obra } = creando
    ? { data: null }
    : await db.from('artworks')
        .select('*, artists(name), institutions(name)')
        .eq('id', numero!).single();

  if (!creando && !obra) notFound();

  /*
   * El título de arriba es el canónico; el que lee un visitante sale de
   * `artwork_translations`. Una obra que espera datos no tiene ninguna fila
   * —se guardan sin traducir para ahorrar espacio—, y entonces el bloque de
   * idiomas sale vacío y las crea al guardarlas.
   */
  const { data: traducciones } = creando
    ? { data: [] }
    : await db.from('artwork_translations').select('*').eq('artwork_id', numero!);

  const defendidos: string[] = [
    ...((obra?.locked_fields as string[] | null) ?? []),
    // El estado tiene su propio guardián desde 0008, pero para quien mira la
    // pantalla es exactamente lo mismo: un campo que la ingesta no puede pisar.
    ...(obra?.status_locked ? ['status'] : []),
  ];

  async function guardar(formData: FormData) {
    'use server';

    const server = await supabaseServer();
    const soltar = formData.getAll('soltar').map(String);

    if (creando) {
      const nuevos = soloLoCambiado(CAMPOS_OBRA, formData, {});

      const { data, error: err } = await server.rpc('create_artwork', { p_datos: nuevos });

      if (err) {
        redirect(`${path(idioma, 'admin')}/corregir/obra/nueva?error=${encodeURIComponent(err.message)}`);
      }
      redirect(`${path(idioma, 'admin')}/corregir/obra/${data}?guardado=1`);
    }

    /*
     * Se relee la fila aquí en vez de fiarse de campos ocultos con los valores
     * originales: entre pintar el formulario y guardarlo puede haber pasado una
     * ingesta entera, y lo que hay que comparar es contra lo que hay AHORA.
     */
    const [{ data: actual }, { data: actuales }] = await Promise.all([
      server.from('artworks').select('*').eq('id', numero!).single(),
      server.from('artwork_translations').select('*').eq('artwork_id', numero!),
    ]);

    const cambios = soloLoCambiado(CAMPOS_OBRA, formData, actual ?? {});

    const base = `${path(idioma, 'admin')}/corregir/obra/${numero}`;
    let fallo: string | null = null;

    if (Object.keys(cambios).length > 0 || soltar.length > 0) {
      const { error: err } = await server.rpc('edit_artwork', {
        p_id: numero, p_cambios: cambios, p_soltar: soltar,
      });
      fallo = err?.message ?? null;
    }

    const porIdioma = traduccionesCambiadas(
      CAMPOS_TRAD_OBRA, LANGS, formData, (actuales ?? []) as Traduccion[],
    );

    for (const t of porIdioma) {
      if (fallo) break;
      const { error: err } = await server.rpc('editar_traduccion', {
        p_entidad: 'artwork', p_id: numero, p_lang: t.lang,
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
        <h1>{creando ? 'Una obra nueva' : (obra!.title as string)}</h1>

        {!creando && (
          <p className="muted small">
            #{obra!.id as number}
            {obra!.wikidata_qid ? ` · ${obra!.wikidata_qid as string}` : ' · sin Wikidata'}
            {' · '}{obra!.source as string}
            {(obra!.artists as { name: string } | null)?.name && ` · ${(obra!.artists as { name: string }).name}`}
            {(obra!.institutions as { name: string } | null)?.name && ` · ${(obra!.institutions as { name: string }).name}`}
            {' · '}<Link href={path(idioma, 'artwork', obra!.id as number)}>ver la ficha pública</Link>
          </p>
        )}
      </header>

      {error && <p className="aviso aviso-mal">{error}</p>}
      {guardado && <p className="aviso aviso-bien">Guardado.</p>}

      {creando && (
        <p className="muted small" style={{ marginTop: 10 }}>
          Entra con procedencia <code>manual</code> y todos sus campos defendidos: no
          viene de ninguna fuente, así que no hay nada ahí fuera que deba cambiarla.
        </p>
      )}

      <form action={guardar}>
        <Ficha
          campos={CAMPOS_OBRA}
          valores={(obra as Record<string, unknown> | null) ?? {}}
          defendidos={defendidos}
        />

        {/* Al crear no hay idiomas: la obra aún no tiene id al que colgarlos. */}
        {!creando && <Traducciones campos={CAMPOS_TRAD_OBRA} filas={(traducciones ?? []) as Traduccion[]} />}

        <div style={{ display: 'flex', gap: 10, padding: '18px 0 40px' }}>
          <button className="btn btn-primary" type="submit">
            {creando ? 'Crear la obra' : 'Guardar los cambios'}
          </button>
          <Link className="btn" href={`${path(idioma, 'admin')}/corregir`}>Dejarlo</Link>
        </div>
      </form>

      {!creando && defendidos.length > 0 && (
        <p className="small muted" style={{ paddingBottom: 30 }}>
          {defendidos.length === 1 ? 'Un campo está defendido' : `${defendidos.length} campos están defendidos`}
          {' '}de la ingesta. El resto lo sigue manteniendo Wikidata.
        </p>
      )}
    </>
  );
}
