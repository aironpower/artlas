/** Tipos de la auditoría. */

export type Severity = 'error' | 'warning' | 'info';
export type EntityType = 'artwork' | 'artist' | 'institution' | 'movement';

export interface Finding {
  entityType: EntityType;
  entityId: number;
  rule: string;
  severity: Severity;
  /** El dato concreto que lo delata: la URL, el nombre, con quién duplica. */
  detail: string;
}

/* Las filas que leen las reglas. Solo las columnas que miran, para que la
 * consulta no arrastre el catálogo entero a memoria. */

export interface ArtworkRow {
  id: number;
  title: string;
  image_url: string | null;
  artist_id: number | null;
  institution_id: number | null;
  year_start: number | null;
  year_end: number | null;
  date_display: string | null;
  notability: number;
}

export interface ArtistRow {
  id: number;
  name: string;
  wikidata_qid: string | null;
  artwork_count: number;
}

export interface MovementRow {
  id: number;
  name: string;
  wikidata_qid: string | null;
  artwork_count: number;
}
