import Link from 'next/link';

/**
 * Cabecera de columna que ordena la tabla.
 *
 * Es un enlace y no un botón con JavaScript, por lo mismo que el resto de la
 * app: el orden queda en la URL, así que se puede compartir «los museos por
 * ciudad», el botón de atrás deshace, y funciona sin hidratar.
 *
 * La flecha va en el texto y no como icono aparte para que un lector de
 * pantalla la lea junto al nombre de la columna; `aria-sort` le dice además
 * cuál manda, que es lo que una tabla ordenada tiene que anunciar.
 */
export function Ordenable(
  { etiqueta, campo, orden, dir, base, extra = '', opcional = false }: {
    etiqueta: string;
    /** El valor de `orden` que activa esta columna. */
    campo: string;
    orden: string;
    dir: 'asc' | 'desc';
    /** Ruta de la página, sin parámetros. */
    base: string;
    /** Parámetros que hay que conservar al reordenar (la búsqueda, por ejemplo). */
    extra?: string;
    /** Si se esconde en pantalla estrecha, donde no caben cuatro columnas. */
    opcional?: boolean;
  },
) {
  const activa = orden === campo;

  /*
   * Al pulsar una columna que ya manda, se le da la vuelta. Al pulsar otra,
   * empieza por el orden que more sentido tiene para ella: los números de
   * mayor a menor —lo que más obras tiene interesa primero— y el texto de la A
   * a la Z. Empezar un nombre por la Z no se lo espera nadie.
   */
  const siguiente = activa ? (dir === 'asc' ? 'desc' : 'asc')
    : (campo === 'obras' ? 'desc' : 'asc');

  const params = new URLSearchParams(extra);
  params.set('orden', campo);
  params.set('dir', siguiente);

  return (
    <th
      className={opcional ? 'col-opcional' : undefined}
      aria-sort={activa ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <Link href={`${base}?${params}`} className={activa ? 'orden-activo' : undefined}>
        {etiqueta}{activa ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </Link>
    </th>
  );
}
