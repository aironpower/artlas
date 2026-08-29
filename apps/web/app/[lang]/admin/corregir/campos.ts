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
