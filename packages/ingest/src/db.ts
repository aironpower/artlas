/**
 * Capa de escritura a Supabase.
 *
 * Toda la ingesta usa la service_role key, que salta RLS. Nunca debe llegar
 * al navegador: solo vive en el .env del proceso de ingesta.
 *
 * Estrategia general: upsert idempotente contra claves naturales
 * (wikidata_qid, o el par source+source_id). Reejecutar la ingesta entera
 * debe actualizar, nunca duplicar.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CanonicalArtist, CanonicalArtwork, CanonicalInstitution, CanonicalMovement,
  Localized,
} from './types.js';
import type { Classified } from './audit/gate.js';
import { slugify } from './normalize.js';

/**
 * Convierte los campos localizados de una entidad en filas de traducción.
 *
 * Recibe un mapa de campo -> textos por idioma y devuelve una fila por idioma,
 * saltándose los que no tengan el campo obligatorio. Una obra puede tener
 * título en francés pero descripción solo en inglés: aquí eso produce dos
 * filas distintas, cada una con lo que realmente hay.
 */
function toTranslationRows(
  fields: Record<string, Localized | undefined>,
  required: string,
): Map<string, Record<string, string>> {
  const byLang = new Map<string, Record<string, string>>();

  for (const [field, localized] of Object.entries(fields)) {
    for (const [lang, text] of Object.entries(localized ?? {})) {
      if (!text) continue;
      const row = byLang.get(lang) ?? {};
      row[field] = text;
      byLang.set(lang, row);
    }
  }

  // Sin el campo obligatorio (título, nombre) la fila no sirve para nada.
  for (const [lang, row] of byLang) {
    if (!row[required]) byLang.delete(lang);
  }

  return byLang;
}

export function createDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. Copia .env.example a .env.',
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** PostGIS acepta WKT directamente en una columna geography. */
const point = (lat?: number, lng?: number): string | null =>
  lat === undefined || lng === undefined ? null : `SRID=4326;POINT(${lng} ${lat})`;

/**
 * Caché de ids en memoria. Sin ella, ingerir 5.000 obras del Prado lanzaría
 * 5.000 upserts idénticos del mismo artista y de la misma institución.
 */
export class IdCache {
  private institutions = new Map<string, number>();
  private artists = new Map<string, number>();
  private movements = new Map<string, number>();

  constructor(private readonly db: SupabaseClient) {}

  async institutionId(inst: CanonicalInstitution): Promise<number | null> {
    const key = inst.wikidataQid ?? `name:${slugify(inst.name)}`;
    const cached = this.institutions.get(key);
    if (cached !== undefined) return cached;

    const { data, error } = await this.db
      .from('institutions')
      .upsert(
        {
          wikidata_qid: inst.wikidataQid ?? null,
          name: inst.name,
          slug: slugify(inst.name),
          kind: inst.kind ?? 'museum',
          city: inst.city ?? null,
          region: inst.region ?? null,
          country: inst.country ?? null,
          country_code: inst.countryCode?.toUpperCase() ?? null,
          location: point(inst.lat, inst.lng),
          website: inst.website ?? null,
          image_url: inst.imageUrl ?? null,
          visitors_year: inst.visitorsYear ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'wikidata_qid' },
      )
      .select('id')
      .single();

    if (error) throw new Error(`institución "${inst.name}": ${error.message}`);

    await this.saveTranslations('institution_translations', 'institution_id', data.id,
      toTranslationRows(
        { name: inst.names, description: inst.descriptions, city: inst.cities, country: inst.countries },
        'name',
      ));

    this.institutions.set(key, data.id);
    return data.id;
  }

  /** Escribe las filas de traducción de una entidad, una por idioma. */
  private async saveTranslations(
    table: string,
    fkColumn: string,
    id: number,
    byLang: Map<string, Record<string, string>>,
  ): Promise<void> {
    if (byLang.size === 0) return;

    const rows = [...byLang].map(([lang, fields]) => ({ [fkColumn]: id, lang, ...fields }));

    const { error } = await this.db.from(table).upsert(rows, { onConflict: `${fkColumn},lang` });
    if (error) throw new Error(`${table} (id ${id}): ${error.message}`);
  }

  async artistId(artist: CanonicalArtist): Promise<number | null> {
    const key = artist.wikidataQid ?? `name:${slugify(artist.name)}`;
    const cached = this.artists.get(key);
    if (cached !== undefined) return cached;

    // Sin QID no hay clave natural en la tabla (el slug no es único, porque
    // hay homónimos), así que buscamos primero e insertamos solo si no está.
    if (!artist.wikidataQid) {
      const slug = slugify(artist.name);
      const { data: existing } = await this.db
        .from('artists').select('id').eq('slug', slug).limit(1).maybeSingle();

      if (existing) {
        this.artists.set(key, existing.id);
        return existing.id;
      }

      const { data: created, error: insertError } = await this.db
        .from('artists')
        .insert({
          name: artist.name,
          slug,
          sort_name: artist.sortName ?? null,
          birth_year: artist.birthYear ?? null,
          death_year: artist.deathYear ?? null,
          nationality: artist.nationality ?? null,
        })
        .select('id')
        .single();

      if (insertError) throw new Error(`artista "${artist.name}": ${insertError.message}`);

      this.artists.set(key, created.id);
      return created.id;
    }

    const { data, error } = await this.db
      .from('artists')
      .upsert(
        {
          wikidata_qid: artist.wikidataQid ?? null,
          name: artist.name,
          slug: slugify(artist.name),
          sort_name: artist.sortName ?? null,
          birth_year: artist.birthYear ?? null,
          death_year: artist.deathYear ?? null,
          nationality: artist.nationality ?? null,
          image_url: artist.imageUrl ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'wikidata_qid' },
      )
      .select('id')
      .single();

    if (error) throw new Error(`artista "${artist.name}": ${error.message}`);

    await this.saveTranslations('artist_translations', 'artist_id', data.id,
      toTranslationRows({ name: artist.names, description: artist.descriptions }, 'name'));

    this.artists.set(key, data.id);
    return data.id;
  }

  /**
   * Los movimientos llegan por dos vías con formas distintas: Wikidata da QID
   * ("Q166713", "posimpresionismo") y AIC solo un nombre ("Post-Impressionism").
   * Sin QID hay que buscar por slug antes de insertar, o el mismo movimiento
   * acabaría duplicado con y sin identificador.
   */
  /**
   * Alias de movimiento cargados una sola vez.
   *
   * Son decenas de filas y se consultarían por cada movimiento de cada obra;
   * traerlos de golpe cambia miles de viajes de red por uno.
   */
  private aliases: Map<string, number> | null = null;

  private async loadAliases(): Promise<Map<string, number>> {
    if (this.aliases) return this.aliases;

    const { data, error } = await this.db
      .from('movement_aliases').select('alias_qid, alias_slug, movement_id');

    // Si la tabla no existe todavía (esquema viejo), se sigue sin alias.
    if (error) return (this.aliases = new Map());

    const map = new Map<string, number>();
    for (const a of data ?? []) {
      if (a.alias_qid) map.set(`qid:${a.alias_qid}`, a.movement_id);
      if (a.alias_slug) map.set(`slug:${a.alias_slug}`, a.movement_id);
    }

    return (this.aliases = map);
  }

  async movementId(movement: CanonicalMovement): Promise<number | null> {
    const slug = slugify(movement.name);
    const key = movement.wikidataQid ?? `name:${slug}`;
    const cached = this.movements.get(key);
    if (cached !== undefined) return cached;

    /*
     * Antes de nada, ¿alguien decidió ya que esto es otro movimiento?
     *
     * Sin esta consulta, fusionar duplicados sería trabajo perdido: la
     * siguiente ingesta volvería a crear "Baroque painting" en cuanto una obra
     * lo declarara, y a los dos días habría 237 movimientos otra vez.
     */
    const aliases = await this.loadAliases();
    const aliased = (movement.wikidataQid ? aliases.get(`qid:${movement.wikidataQid}`) : undefined)
      ?? aliases.get(`slug:${slug}`);

    if (aliased !== undefined) {
      this.movements.set(key, aliased);
      return aliased;
    }

    if (!movement.wikidataQid) {
      const { data: existing } = await this.db
        .from('movements').select('id').eq('slug', slug).limit(1).maybeSingle();

      if (existing) {
        this.movements.set(key, existing.id);
        return existing.id;
      }

      const { data: created, error: insertError } = await this.db
        .from('movements')
        .insert({ name: movement.name, slug })
        .select('id')
        .single();

      if (insertError) throw new Error(`movimiento "${movement.name}": ${insertError.message}`);

      this.movements.set(key, created.id);
      return created.id;
    }

    const { data, error } = await this.db
      .from('movements')
      .upsert(
        {
          wikidata_qid: movement.wikidataQid,
          name: movement.name,
          slug,
          start_year: movement.startYear ?? null,
          end_year: movement.endYear ?? null,
        },
        { onConflict: 'wikidata_qid' },
      )
      .select('id')
      .single();

    if (error) throw new Error(`movimiento "${movement.name}": ${error.message}`);

    await this.saveTranslations('movement_translations', 'movement_id', data.id,
      toTranslationRows({ name: movement.names }, 'name'));

    this.movements.set(key, data.id);
    return data.id;
  }
}

export interface UpsertResult { inserted: number; updated: number }

/**
 * Escribe un lote de obras con sus relaciones.
 *
 * Va en lotes y no obra a obra porque la latencia de red domina: 500 upserts
 * sueltos contra Supabase tardan minutos, uno de 500 filas tarda segundos.
 */
export async function upsertArtworks(
  db: SupabaseClient,
  cache: IdCache,
  /*
   * Cada obra viene con el estado que le puso el clasificador. No se recibe
   * `CanonicalArtwork[]` a secas porque escribir sin estado dejaría todo en
   * `pending` por el valor por defecto de la columna, y el catálogo
   * desaparecería de la app entera en la siguiente ingesta.
   */
  classified: Classified[],
): Promise<UpsertResult> {
  if (classified.length === 0) return { inserted: 0, updated: 0 };

  const works = classified.map((c) => c.work);

  // 1. Resolver las claves foráneas (con caché, casi siempre es un hit).
  const rows = [];
  const movementsByIndex: number[][] = [];

  for (const [index, work] of works.entries()) {
    const meta = classified[index]!;
    const institutionId = work.institution ? await cache.institutionId(work.institution) : null;
    const artistId = work.artist ? await cache.artistId(work.artist) : null;

    const movementIds: number[] = [];
    for (const movement of work.movements ?? []) {
      const id = await cache.movementId(movement);
      if (id !== null) movementIds.push(id);
    }
    movementsByIndex.push(movementIds);

    rows.push({
      wikidata_qid: work.wikidataQid ?? null,
      title: work.title,
      slug: slugify(work.title),
      artist_id: artistId,
      institution_id: institutionId,
      year_start: work.yearStart ?? null,
      year_end: work.yearEnd ?? null,
      date_display: work.dateDisplay ?? null,
      category: work.category,
      medium: work.medium ?? null,
      height_cm: work.heightCm ?? null,
      width_cm: work.widthCm ?? null,
      image_url: work.imageUrl ?? null,
      iiif_base: work.iiifBase ?? null,
      image_license: work.imageLicense ?? null,
      source: work.source,
      source_id: work.sourceId,
      source_url: work.sourceUrl ?? null,
      notability: work.notability ?? 0,
      // Copia de la geometría del museo: el mapa filtra por bbox sin join.
      location: point(work.institution?.lat, work.institution?.lng),

      status: meta.status,
      pending_reason: meta.reason,
      rights_status: meta.rightsStatus,
      inventory_number: work.inventoryNumber ?? null,
    });
  }

  // 2. Upsert de las obras.
  const { data, error } = await db
    .from('artworks')
    .upsert(rows, { onConflict: 'source,source_id' })
    .select('id');

  if (error) throw new Error(`lote de obras: ${error.message}`);

  /*
   * 3. Traducciones. Van todas en un upsert porque son ~3 filas por obra y
   *    hacerlo obra a obra multiplicaría por tres los viajes a la red.
   *
   *    SOLO para lo publicado, y esto es lo que hace viable amasar el catálogo
   *    entero. Una obra pendiente no se muestra en ninguna parte, así que sus
   *    traducciones no las lee nadie; pero cada fila arrastra además su vector
   *    de búsqueda, que es lo que de verdad ocupa. Con 182.000 obras por tres
   *    idiomas serían ~550.000 filas y unos 240 MB de los 500 MB del plan
   *    gratuito, gastados en texto invisible.
   *
   *    La obra pendiente conserva `artworks.title`, el título neutro, que es
   *    suficiente para listarla en el panel de revisión. Al promoverla hay que
   *    hidratarla: es el precio de esta decisión y está asumido.
   */
  const translations = data.flatMap((row, i) => {
    const work = works[i];
    if (!work || classified[i]?.status !== 'published') return [];

    return [...toTranslationRows(
      {
        title: work.titles,
        description: work.descriptions,
        medium: work.mediums,
        genre: work.genres,
      },
      'title',
    )].map(([lang, fields]) => ({ artwork_id: row.id, lang, ...fields }));
  });

  if (translations.length > 0) {
    const { error: trError } = await db
      .from('artwork_translations')
      .upsert(translations, { onConflict: 'artwork_id,lang' });

    if (trError) throw new Error(`traducciones de obras: ${trError.message}`);
  }

  // 4. Relaciones obra <-> movimiento.
  const links = data.flatMap((row, i) =>
    (movementsByIndex[i] ?? []).map((movementId) => ({
      artwork_id: row.id,
      movement_id: movementId,
    })),
  );

  if (links.length > 0) {
    const { error: linkError } = await db
      .from('artwork_movements')
      .upsert(links, { onConflict: 'artwork_id,movement_id', ignoreDuplicates: true });

    if (linkError) throw new Error(`movimientos: ${linkError.message}`);
  }

  return { inserted: data.length, updated: 0 };
}

/**
 * Recalcula los contadores denormalizados.
 * Se llama al final de la ingesta, no por obra: son tres UPDATE de tabla
 * completa y ejecutarlos en bucle sería absurdamente caro.
 */
export async function refreshCounters(db: SupabaseClient): Promise<void> {
  const { error } = await db.rpc('refresh_artwork_counters');
  if (error) throw new Error(`contadores: ${error.message}`);
}
