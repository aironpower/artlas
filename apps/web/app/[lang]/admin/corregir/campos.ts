/**
 * Qué campos se pueden corregir a mano, y cómo se pintan.
 *
 * La lista tiene que coincidir con `campos_editables_obra()` y
 * `campos_editables_artista()` de la base (migración 0030). Si aquí sobra un
 * campo, la base lo rechaza con su nombre —«ese campo no se edita a mano»—, que
 * es un fallo ruidoso y por tanto aceptable. Si aquí falta, simplemente no se
 * puede corregir desde la web.
 *
 * Los valores de los desplegables NO están escritos de memoria: salen de las
 * restricciones `check` de la propia tabla. Escribirlos a ojo ya causó una
 * migración de más hoy mismo.
 */

export interface Campo {
  nombre: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'decimal' | 'url' | 'lista' | 'largo';
  opciones?: readonly string[];
  ancho?: 'corto' | 'medio' | 'largo';
  /** Se explica solo cuando no es evidente. */
  pie?: string;
}

export const ESTADOS = ['published', 'pending', 'rejected'] as const;

export const CATEGORIAS = [
  'painting', 'sculpture', 'drawing', 'print',
  'photograph', 'installation', 'decorative', 'other',
] as const;

export const DERECHOS = ['public_domain', 'in_copyright', 'unknown'] as const;

/** Cómo se dicen en castellano, para que el desplegable no hable en inglés. */
export const NOMBRES: Record<string, string> = {
  published: 'publicada', pending: 'esperando datos', rejected: 'no es una obra',
  painting: 'pintura', sculpture: 'escultura', drawing: 'dibujo', print: 'estampa',
  photograph: 'fotografía', installation: 'instalación', decorative: 'artes decorativas',
  other: 'otra',
  public_domain: 'dominio público', in_copyright: 'con derechos', unknown: 'sin averiguar',
  museum: 'museo', gallery: 'galería', church: 'iglesia', palace: 'palacio',
  public_space: 'espacio público', private: 'colección privada',
};

export const CAMPOS_OBRA: readonly Campo[] = [
  { nombre: 'title', etiqueta: 'Título', tipo: 'texto', ancho: 'largo' },
  { nombre: 'year_start', etiqueta: 'Año (desde)', tipo: 'numero', ancho: 'corto' },
  { nombre: 'year_end', etiqueta: 'Año (hasta)', tipo: 'numero', ancho: 'corto' },
  {
    nombre: 'date_display', etiqueta: 'Fecha, como se lee', tipo: 'texto', ancho: 'medio',
    pie: 'Lo que ve el visitante: «c. 1503-1519».',
  },
  { nombre: 'category', etiqueta: 'Categoría', tipo: 'lista', opciones: CATEGORIAS, ancho: 'medio' },
  { nombre: 'medium', etiqueta: 'Técnica', tipo: 'texto', ancho: 'medio' },
  { nombre: 'height_cm', etiqueta: 'Alto (cm)', tipo: 'decimal', ancho: 'corto' },
  { nombre: 'width_cm', etiqueta: 'Ancho (cm)', tipo: 'decimal', ancho: 'corto' },
  { nombre: 'inventory_number', etiqueta: 'Nº de inventario', tipo: 'texto', ancho: 'medio' },
  { nombre: 'image_url', etiqueta: 'Imagen', tipo: 'url', ancho: 'largo' },
  {
    nombre: 'thumbnail_url', etiqueta: 'Miniatura', tipo: 'url', ancho: 'largo',
    pie: 'Para las obras con derechos, que solo se enseñan en pequeño.',
  },
  {
    nombre: 'origin_url', etiqueta: 'Ficha en el museo', tipo: 'url', ancho: 'largo',
    pie: 'Obligatoria si la obra tiene derechos: es a donde se manda al visitante.',
  },
  { nombre: 'source_url', etiqueta: 'De dónde salió el dato', tipo: 'url', ancho: 'largo' },
  {
    nombre: 'status', etiqueta: 'Estado', tipo: 'lista', opciones: ESTADOS, ancho: 'medio',
    pie: 'Lo que decidas aquí no lo deshace la ingesta.',
  },
  { nombre: 'pending_reason', etiqueta: 'Qué le falta', tipo: 'texto', ancho: 'medio' },
  { nombre: 'rights_status', etiqueta: 'Derechos', tipo: 'lista', opciones: DERECHOS, ancho: 'medio' },
  { nombre: 'rights_statement', etiqueta: 'Nota de derechos', tipo: 'largo', ancho: 'largo' },
];

export const CAMPOS_ARTISTA: readonly Campo[] = [
  { nombre: 'name', etiqueta: 'Nombre', tipo: 'texto', ancho: 'largo' },
  {
    nombre: 'sort_name', etiqueta: 'Nombre para ordenar', tipo: 'texto', ancho: 'medio',
    pie: '«Goya, Francisco de».',
  },
  { nombre: 'birth_year', etiqueta: 'Nació', tipo: 'numero', ancho: 'corto' },
  { nombre: 'death_year', etiqueta: 'Murió', tipo: 'numero', ancho: 'corto' },
  { nombre: 'nationality', etiqueta: 'Nacionalidad', tipo: 'texto', ancho: 'medio' },
  { nombre: 'country_code', etiqueta: 'País (2 letras)', tipo: 'texto', ancho: 'corto' },
  { nombre: 'image_url', etiqueta: 'Retrato', tipo: 'url', ancho: 'largo' },
];

/**
 * Los cambios de verdad, comparando con lo que hay guardado.
 *
 * Es la pieza que decide qué queda bloqueado, y por eso compara en vez de
 * mandarlo todo: si al guardar se enviaran los diecisiete campos, los
 * diecisiete quedarían defendidos de la ingesta por el mero hecho de haber
 * abierto el formulario. Corregir el título de una obra no puede significar
 * congelar su ficha entera.
 */
export function soloLoCambiado(
  campos: readonly Campo[],
  formulario: FormData,
  actual: Record<string, unknown>,
): Record<string, string | null> {
  const cambios: Record<string, string | null> = {};

  for (const campo of campos) {
    const bruto = formulario.get(campo.nombre);
    if (bruto === null) continue;

    const nuevo = String(bruto).trim();
    const viejo = actual[campo.nombre] === null || actual[campo.nombre] === undefined
      ? ''
      : String(actual[campo.nombre]);

    if (nuevo === viejo) continue;

    // Vaciar una casilla es querer borrar el dato, no ignorarlo.
    cambios[campo.nombre] = nuevo === '' ? null : nuevo;
  }

  return cambios;
}

/* ---------------------------------------------------------------------------
 * Museos, movimientos y traducciones (0033)
 *
 * Las listas de aquí abajo tienen que coincidir con `campos_editables()` de la
 * base. Si aquí sobra un campo, la base lo rechaza por su nombre; si falta, no
 * se puede corregir desde la web.
 * ------------------------------------------------------------------------- */

/** Los valores del `check` de `institutions.kind`, mirados en 0001. */
export const CLASES = [
  'museum', 'gallery', 'church', 'palace', 'public_space', 'private', 'other',
] as const;

export const CAMPOS_MUSEO: readonly Campo[] = [
  { nombre: 'name', etiqueta: 'Nombre', tipo: 'texto', ancho: 'largo' },
  { nombre: 'kind', etiqueta: 'Qué es', tipo: 'lista', opciones: CLASES, ancho: 'medio' },
  {
    nombre: 'city', etiqueta: 'Ciudad', tipo: 'texto', ancho: 'medio',
    pie: 'La ciudad, no el barrio: Wikidata da «Montjuïc» donde debería decir Barcelona.',
  },
  { nombre: 'region', etiqueta: 'Región', tipo: 'texto', ancho: 'medio' },
  { nombre: 'country', etiqueta: 'País', tipo: 'texto', ancho: 'medio' },
  { nombre: 'country_code', etiqueta: 'País (2 letras)', tipo: 'texto', ancho: 'corto' },
  { nombre: 'address', etiqueta: 'Dirección', tipo: 'texto', ancho: 'largo' },
  { nombre: 'website', etiqueta: 'Web', tipo: 'url', ancho: 'largo' },
  { nombre: 'image_url', etiqueta: 'Foto', tipo: 'url', ancho: 'largo' },
  {
    nombre: 'visitors_year', etiqueta: 'Visitantes al año', tipo: 'numero', ancho: 'medio',
    pie: 'Ordena los museos por relevancia cuando no hay nada mejor.',
  },
  { nombre: 'description', etiqueta: 'Descripción', tipo: 'largo', ancho: 'largo' },
];

export const CAMPOS_MOVIMIENTO: readonly Campo[] = [
  { nombre: 'name', etiqueta: 'Nombre', tipo: 'texto', ancho: 'largo' },
  { nombre: 'start_year', etiqueta: 'Desde', tipo: 'numero', ancho: 'corto' },
  { nombre: 'end_year', etiqueta: 'Hasta', tipo: 'numero', ancho: 'corto' },
  { nombre: 'description', etiqueta: 'Descripción', tipo: 'largo', ancho: 'largo' },
];

/*
 * Lo que se traduce de cada cosa. Es MENOS de lo que se puede editar en la
 * ficha canónica, a propósito: un año o una URL no cambian con el idioma, y
 * ofrecerlos por idioma invita a que se desincronicen.
 */
export const CAMPOS_TRAD_OBRA: readonly Campo[] = [
  { nombre: 'title', etiqueta: 'Título', tipo: 'texto', ancho: 'largo' },
  { nombre: 'medium', etiqueta: 'Técnica', tipo: 'texto', ancho: 'medio' },
  { nombre: 'genre', etiqueta: 'Género', tipo: 'texto', ancho: 'medio' },
  { nombre: 'description', etiqueta: 'Descripción', tipo: 'largo', ancho: 'largo' },
];

export const CAMPOS_TRAD_ARTISTA: readonly Campo[] = [
  { nombre: 'name', etiqueta: 'Nombre', tipo: 'texto', ancho: 'largo' },
  { nombre: 'description', etiqueta: 'Descripción', tipo: 'largo', ancho: 'largo' },
];

export const CAMPOS_TRAD_MUSEO: readonly Campo[] = [
  { nombre: 'name', etiqueta: 'Nombre', tipo: 'texto', ancho: 'largo' },
  { nombre: 'city', etiqueta: 'Ciudad', tipo: 'texto', ancho: 'medio' },
  { nombre: 'country', etiqueta: 'País', tipo: 'texto', ancho: 'medio' },
  { nombre: 'description', etiqueta: 'Descripción', tipo: 'largo', ancho: 'largo' },
];

export const CAMPOS_TRAD_MOVIMIENTO: readonly Campo[] = [
  { nombre: 'name', etiqueta: 'Nombre', tipo: 'texto', ancho: 'largo' },
  { nombre: 'description', etiqueta: 'Descripción', tipo: 'largo', ancho: 'largo' },
];

/** Una fila de traducción tal y como la lee y la escribe el formulario. */
export interface Traduccion {
  lang: string;
  locked_fields?: string[] | null;
  [campo: string]: unknown;
}

/** El prefijo con el que viajan los campos traducidos en el formulario. */
export const campoTraducido = (lang: string, campo: string) => `t.${lang}.${campo}`;

/**
 * Lo que ha cambiado en cada idioma, comparando con lo guardado.
 *
 * Mismo criterio que `soloLoCambiado()` y por el mismo motivo: si se enviaran
 * todos los campos de todos los idiomas, abrir el formulario y guardarlo
 * congelaría el catálogo entero frente a Wikidata. Aquí se devuelve un idioma
 * solo si algo suyo cambió de verdad.
 */
export function traduccionesCambiadas(
  campos: readonly Campo[],
  idiomas: readonly string[],
  formulario: FormData,
  actuales: Traduccion[],
): { lang: string; cambios: Record<string, string | null>; soltar: string[] }[] {
  const salida: { lang: string; cambios: Record<string, string | null>; soltar: string[] }[] = [];

  for (const lang of idiomas) {
    const fila = actuales.find((t) => t.lang === lang) ?? { lang };
    const cambios: Record<string, string | null> = {};

    for (const campo of campos) {
      const bruto = formulario.get(campoTraducido(lang, campo.nombre));
      if (bruto === null) continue;

      const nuevo = String(bruto).trim();
      const viejo = fila[campo.nombre] === null || fila[campo.nombre] === undefined
        ? ''
        : String(fila[campo.nombre]);

      if (nuevo !== viejo) cambios[campo.nombre] = nuevo === '' ? null : nuevo;
    }

    const soltar = formulario.getAll(`soltar.${lang}`).map(String);

    if (Object.keys(cambios).length > 0 || soltar.length > 0) {
      salida.push({ lang, cambios, soltar });
    }
  }

  return salida;
}
