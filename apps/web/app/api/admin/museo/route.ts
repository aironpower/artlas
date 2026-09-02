/**
 * Buscar un museo en Wikidata por su nombre, para el panel de ingesta.
 *
 * Existe para quitar el único paso del formulario que todavía pedía saber cómo
 * funciona esto por dentro: teclear un QID. Quien no sepa qué es Wikidata no
 * sabe de dónde sacarlo, y ese era el motivo por el que añadir un museo no se
 * podía delegar en nadie.
 *
 * Va por el servidor y no desde el navegador —aunque la API de Wikidata admite
 * CORS— por tres razones:
 *
 * Una: se puede decir quién llama. Wikidata pide un `User-Agent` que identifique
 * la aplicación, y ese encabezado el navegador no deja ponerlo.
 *
 * Dos: **se cruza con el catálogo**. Un candidato que ya tenemos no es lo mismo
 * que uno nuevo —uno se actualiza, el otro entra de cero— y esa consulta es a
 * nuestra base, no a Wikidata.
 *
 * Tres: es de administrador. La búsqueda no es secreta, pero saber qué museos
 * tenemos y con cuántas obras es información del panel.
 */

import { NextResponse } from 'next/server';
import { viewerIsAdmin, supabaseServer } from '@/lib/auth';
import { isLang, type Lang } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

const CONTACTO = 'https://artlas.softie.dev';
const AGENTE = `Artlas/0.1 (${process.env.NEXT_PUBLIC_SITE_URL || CONTACTO})`;

/** Un QID escrito a mano: la Q y números, sin ceros a la izquierda. */
const ES_QID = /^Q[1-9][0-9]*$/;

interface Candidato {
  qid: string;
  nombre: string;
  descripcion: string | null;
  /** Si ya está en el catálogo: encargarlo será una actualización, no un alta. */
  catalogo: { id: number; obras: number; ciudad: string | null } | null;
  /** ¿Wikidata lo sitúa en el mapa? Sin coordenadas no puede ser una chincheta. */
  situado: boolean;
}

async function wikidata<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': AGENTE, Accept: 'application/json' },
      // 8 s, como el buscador de sitios: pasado eso la respuesta ya no sirve
      // para escribir en una caja, y siempre queda pegar el QID a mano.
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 600 },
    });
    return res.ok ? await res.json() as T : null;
  } catch {
    return null;
  }
}

interface RespuestaBusqueda {
  search?: { id: string; label?: string; description?: string }[];
}

interface RespuestaEntidades {
  entities?: Record<string, {
    missing?: unknown;
    labels?: Record<string, { value: string }>;
    descriptions?: Record<string, { value: string }>;
  }>;
}

interface RespuestaCoordenadas {
  query?: { pages?: Record<string, { title?: string; coordinates?: unknown[] }> };
}

/**
 * De un puñado de candidatos, los que Wikidata sitúa en un punto del mapa.
 *
 * Es el filtro que convierte esta caja en algo que se puede poner delante de
 * alguien que no sepa qué es Wikidata. `wbsearchentities` busca por etiqueta y
 * no por tipo, así que «Museo del Prado» devolvía el museo y detrás seis
 * ediciones del libro de Alfonso Pérez Sánchez, todas llamadas igual; y
 * «xyzzy museo inventado» acababa ofreciendo un editor de texto. Una lista así
 * es peor que ninguna: pide elegir a quien no puede distinguir.
 *
 * Tener coordenadas no es un rodeo para decir «es un museo»: es exactamente lo
 * que el catálogo necesita de él. Un museo sin punto no puede ser una chincheta
 * del mapa, que es para lo que existe Artlas.
 *
 * Se pregunta por `prop=coordinates` y no por las declaraciones enteras porque
 * se midió: los `claims` de siete candidatos son 205 KB y 1,5 s; esto son
 * 473 bytes y 0,28 s, y contesta lo mismo.
 */
async function situados(qids: string[]): Promise<Set<string>> {
  const datos = await wikidata<RespuestaCoordenadas>(
    'https://www.wikidata.org/w/api.php?action=query&format=json&origin=*' +
    `&prop=coordinates&titles=${qids.join('%7C')}`,
  );

  const paginas = Object.values(datos?.query?.pages ?? {});
  return new Set(
    paginas.filter((p) => (p.coordinates?.length ?? 0) > 0)
      .map((p) => String(p.title)),
  );
}

/** La primera etiqueta que exista, en el orden en que se prefieren. */
function primera(
  valores: Record<string, { value: string }> | undefined,
  idiomas: string[],
): string | null {
  for (const l of idiomas) {
    const v = valores?.[l]?.value;
    if (v) return v;
  }
  return null;
}

/**
 * Un QID concreto, resuelto a su nombre.
 *
 * Se pregunta a la API de entidades y no a SPARQL a propósito, por lo que costó
 * averiguarlo el 2 de septiembre: WDQS con un QID inventado no falla rápido,
 * reintenta y muere en medio minuto con «504 Gateway Timeout». Aquí un QID que
 * no existe se contesta al momento, y quien se equivoque de número lo ve ANTES
 * de encargar nada en vez de después de una ingesta fallida.
 */
async function porQid(qid: string, lang: Lang): Promise<Candidato | null> {
  const idiomas = [...new Set([lang, 'en', 'es'])];

  const datos = await wikidata<RespuestaEntidades>(
    'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*' +
    `&props=labels|descriptions&languages=${idiomas.join('|')}&ids=${qid}`,
  );

  const entidad = datos?.entities?.[qid];
  if (!entidad || entidad.missing !== undefined) return null;

  /*
   * Un QID pegado a mano NO se filtra por coordenadas, solo se marca. Quien
   * escribe una Q y unos números sabe lo que está pegando; lo que le hace falta
   * es que se le avise de que ese no va a poder ir al mapa, no que se le
   * escamotee la respuesta.
   */
  return {
    qid,
    nombre: primera(entidad.labels, idiomas) ?? qid,
    descripcion: primera(entidad.descriptions, idiomas),
    catalogo: null,
    situado: (await situados([qid])).has(qid),
  };
}

/**
 * Buscar por nombre, con la misma maña que `build-seed.ts`.
 *
 * `wbsearchentities` compara por PREFIJO de etiqueta o alias: no es difuso, y
 * eso hace que fallen justo los nombres que uno escribiría con la ciudad
 * detrás para desambiguar («Musée Picasso Paris» no encuentra nada; «Musee
 * Picasso» sí). Por eso se prueba el nombre entero y luego se van quitando
 * palabras por el final.
 *
 * Y se prueba en el idioma de quien busca antes que en inglés, porque el museo
 * que un español escribe como «Museo del Prado» está en inglés como «Museo del
 * Prado» pero el «Museo Picasso» de París no.
 */
async function porNombre(q: string, lang: Lang): Promise<{ lista: Candidato[]; buscado: string }> {
  const palabras = q.split(/\s+/).filter(Boolean);
  const idiomas = [...new Set([lang, 'en'])];

  /*
   * El tope no es cosmético: cada intento es una petición a un servicio
   * gratuito, y un nombre de ocho palabras sin tope serían dieciséis. Con seis
   * caben el nombre entero y dos recortes en los dos idiomas, que es donde
   * aparece el museo cuando aparece.
   */
  let restantes = 6;

  for (let take = palabras.length; take >= 1 && restantes > 0; take--) {
    const intento = palabras.slice(0, take).join(' ');

    for (const idioma of idiomas) {
      if (restantes-- <= 0) break;

      const datos = await wikidata<RespuestaBusqueda>(
        'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*' +
        `&type=item&limit=7&language=${idioma}&uselang=${idioma}` +
        `&search=${encodeURIComponent(intento)}`,
      );

      const encontrados = datos?.search ?? [];
      if (encontrados.length === 0) continue;

      /*
       * Un intento solo cuenta como encontrado si alguno de sus candidatos
       * está en el mapa. Si no, se sigue recortando: sin esto, «xyzzy museo
       * inventado» se quedaba en el primer intento que devolviera cualquier
       * cosa —un editor de texto llamado xyzzy— y lo daba por bueno.
       */
      const enElMapa = await situados(encontrados.map((e) => e.id));
      if (encontrados.every((e) => !enElMapa.has(e.id))) continue;

      /*
       * Los que no están en el mapa se apartan al final, NO se tiran.
       *
       * Se midió antes de decidirlo: tirarlos dejaba fuera el Museo Picasso
       * Málaga, que es un museo de verdad al que Wikidata no le ha puesto
       * coordenadas. Un buscador que esconde el museo que buscas es peor que
       * uno con ruido, y esconderlo además lo haría inalcanzable desde el
       * panel, que es justo lo que esto venía a arreglar. Van detrás y
       * avisados; la pantalla los guarda tras un «ver los otros».
       */
      const ordenados = [...encontrados].sort(
        (a, b) => Number(enElMapa.has(b.id)) - Number(enElMapa.has(a.id)),
      );

      return {
        lista: ordenados.map((e) => ({
          qid: e.id,
          nombre: e.label ?? e.id,
          descripcion: e.description ?? null,
          catalogo: null,
          situado: enElMapa.has(e.id),
        })),
        buscado: intento,
      };
    }
  }

  return { lista: [], buscado: q };
}

export async function GET(request: Request) {
  /*
   * 404 y no 403, igual que `requireAdmin`: un 403 confirma que la ruta existe,
   * y el panel no tiene por qué anunciarse a quien no entra.
   */
  if (!await viewerIsAdmin()) {
    return NextResponse.json({ error: 'no existe' }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').trim();
  const lang = params.get('lang') ?? '';

  if (!isLang(lang)) {
    return NextResponse.json({ error: 'idioma desconocido' }, { status: 400 });
  }
  if (q.length < 2) return NextResponse.json({ museos: [], buscado: q });
  if (q.length > 120) return NextResponse.json({ error: 'consulta larga' }, { status: 400 });

  const { lista, buscado } = ES_QID.test(q)
    ? { lista: [await porQid(q, lang)].filter((c): c is Candidato => c !== null), buscado: q }
    : await porNombre(q, lang);

  /*
   * Lo que ya tenemos. Sin esto, el candidato correcto y el museo que lleva
   * ocho mil obras en el catálogo se leen igual, y quien encarga no sabe si
   * está dando de alta algo nuevo —que cuesta espacio, y quedan ~98 MB— o
   * repitiendo lo que ya está.
   */
  if (lista.length > 0) {
    const db = await supabaseServer();
    const { data } = await db.from('institutions')
      .select('id, wikidata_qid, artwork_count, city')
      .in('wikidata_qid', lista.map((c) => c.qid));

    const nuestros = new Map(
      (data ?? []).map((m) => [m.wikidata_qid as string, m]),
    );

    for (const c of lista) {
      const m = nuestros.get(c.qid);
      if (m) c.catalogo = { id: m.id as number, obras: m.artwork_count as number, ciudad: m.city as string | null };
    }
  }

  return NextResponse.json({ museos: lista, buscado });
}
