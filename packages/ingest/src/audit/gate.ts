/**
 * Puerta de entrada de la ingesta: clasifica, ya no descarta.
 *
 * Nació rechazando, y estuvo mal poco tiempo. Medido contra Wikidata: de las
 * 182.382 obras que existen en nuestros 48 museos teníamos 6.161, y lo que
 * faltaba no era basura — era obra real sin imagen en Commons, que para el
 * siglo XX es sencillamente obra en derechos. Tirarla era perder el catálogo
 * que queremos construir.
 *
 * Ahora toda obra se guarda y lo que decide esto es SU ESTADO:
 *
 *   published  se puede enseñar hoy: tiene imagen, museo y pasa las reglas
 *   pending    existe y es real, pero le falta algo. Espera en la base.
 *   rejected   está probado que no es una obra de arte (el "Google Maps pin")
 *
 * La diferencia entre `pending` y `rejected` es la que importa y la que hay
 * que defender en cada regla nueva: «le falta un dato» nunca es `rejected`.
 *
 * Las reglas siguen siendo las de `rules.ts`, las mismas que usa el auditor.
 * Aquí solo se decide qué consecuencia tiene cada una.
 */

import { auditArtist, auditArtwork, isPeriodName } from './rules.js';
import type { CanonicalArtwork } from '../types.js';

export type Status = 'published' | 'pending' | 'rejected';

/**
 * Reglas que prueban que la fila NO es una obra de arte. Solo estas rechazan.
 *
 *   image_is_vector  un SVG es un icono o un logotipo, no un cuadro
 *   title_is_url     el título quedó sin resolver: no hay obra que describir
 */
const PROVES_NOT_ARTWORK = new Set(['image_is_vector', 'title_is_url']);

/**
 * Reglas que solo dicen que falta un dato. Dejan la obra esperando.
 *
 *   image_missing        sin imagen no hay ficha que enseñar… todavía
 *   institution_missing  sin museo no hay punto en el mapa… todavía
 *
 * Un cuadro del Reina Sofía sin imagen en Commons cae aquí, y ahí se queda
 * hasta que Europeana nos dé su miniatura o hasta que entre en dominio
 * público. Que es exactamente el catálogo que queremos amasar.
 */
const WAITS_FOR_DATA = new Set(['image_missing', 'institution_missing']);

export interface Repair {
  sourceId: string;
  title: string;
  rule: string;
  detail: string;
}

export interface Classified {
  work: CanonicalArtwork;
  status: Status;
  /** Qué le falta, para poder agrupar lo pendiente. Null si está publicada. */
  reason: string | null;
  rightsStatus: 'public_domain' | 'in_copyright' | 'unknown';
}

export interface GateResult {
  rows: Classified[];
  repaired: Repair[];
}

/**
 * Derechos de la obra, por orden de autoridad.
 *
 * 1. Lo que DECLARA la fuente (Wikidata P6216). Lo dicen 8.797 de las 11.541
 *    obras medidas, el 76%.
 * 2. Si no lo dice, la regla de los 70 años desde la muerte del autor — la
 *    misma que `is_public_domain()` en SQL, calculada con el año en curso para
 *    que el catálogo se libere solo cada 1 de enero.
 * 3. Si tampoco hay fecha de muerte, `unknown`, que se trata como si estuviera
 *    en derechos.
 *
 * El orden importa y viene de una equivocación: deduciendo por la fecha de
 * muerte, las 49 obras "en derechos" del catálogo eran Hopper, Warhol,
 * Lichtenstein y Chagall… con su imagen alojada en Wikimedia Commons, que solo
 * admite contenido libre. La fuente decía una cosa y mi deducción otra. Manda
 * la fuente.
 */
export function rightsFor(
  declared: 'public_domain' | 'in_copyright' | undefined,
  deathYear: number | undefined,
): Classified['rightsStatus'] {
  if (declared) return declared;
  if (deathYear === undefined) return 'unknown';
  return deathYear + 70 < new Date().getFullYear() ? 'public_domain' : 'in_copyright';
}

export function classify(works: CanonicalArtwork[]): GateResult {
  const result: GateResult = { rows: [], repaired: [] };

  for (const original of works) {
    let work = original;

    // --- Reparaciones ------------------------------------------------------

    /*
     * Autoría anónima. Wikidata devuelve un nodo `genid` cuando la obra no
     * tiene autor identificado, y guardarlo como nombre creaba un "artista"
     * por obra: 198 de ellos en el catálogo, cada uno con una obra y una URL
     * de 60 caracteres por nombre. Lo correcto es no tener artista.
     */
    if (work.artist) {
      const problems = auditArtist({
        id: 0,
        name: work.artist.name,
        wikidata_qid: work.artist.wikidataQid ?? null,
        artwork_count: 0,
      });

      if (problems.some((p) => p.rule === 'name_is_url')) {
        result.repaired.push({
          sourceId: work.sourceId,
          title: work.title,
          rule: 'anonymous_author',
          detail: 'autoría anónima en Wikidata; se guarda sin artista',
        });
        work = { ...work, artist: undefined };
      }
    }

    /* Épocas coladas como movimientos ("17th Century"): fuera la etiqueta,
     * que la obra es buena. */
    const movements = work.movements ?? [];
    const real = movements.filter((m) => m.name.trim() && !isPeriodName(m.name));

    if (real.length !== movements.length) {
      result.repaired.push({
        sourceId: work.sourceId,
        title: work.title,
        rule: 'movement_is_period',
        detail: `descartado como movimiento: ${movements.filter((m) => !real.includes(m))
          .map((m) => m.name || '(vacío)').join(', ')}`,
      });
      work = { ...work, movements: real };
    }

    // --- Clasificación -----------------------------------------------------

    const findings = auditArtwork({
      id: 0,
      title: work.title,
      image_url: work.imageUrl ?? null,
      artist_id: work.artist ? 1 : null,
      institution_id: work.institution ? 1 : null,
      year_start: work.yearStart ?? null,
      year_end: work.yearEnd ?? null,
      date_display: work.dateDisplay ?? null,
      notability: work.notability ?? 0,
    });

    const fatal = findings.find((f) => PROVES_NOT_ARTWORK.has(f.rule));
    const waiting = findings.find((f) => WAITS_FOR_DATA.has(f.rule));

    const status: Status = fatal ? 'rejected' : waiting ? 'pending' : 'published';

    result.rows.push({
      work,
      status,
      reason: fatal?.rule ?? waiting?.rule ?? null,
      rightsStatus: rightsFor(work.copyrightStatus, work.artist?.deathYear),
    });
  }

  return result;
}
