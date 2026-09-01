/**
 * Comprueba la comparación incremental sin red y sin base.
 *
 *   npm run check-incremental
 *
 * Dos cosas distintas, y la segunda es la que de verdad importa a la larga.
 *
 * 1. Que `planificar` decida bien. Es una función pura, así que se le pueden
 *    poner los casos difíciles delante sin montar nada.
 *
 * 2. **Que la lista de campos comparados no se quede atrás.** Es el fallo mudo
 *    que este fichero existe para impedir: el día que alguien añada una columna
 *    a lo que la ingesta escribe y no la añada a `CAMPOS_COMPARADOS`, esa
 *    columna dejará de detectarse como cambio. No falla nada, no avisa nadie, y
 *    los refrescos empiezan a pasar por encima de ese dato para siempre. Aquí
 *    se leen las claves que `upsertArtworks` escribe de verdad —de su propio
 *    código— y se contrastan con las que se comparan.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CAMPOS_COMPARADOS, clave, mismoValor, planificar, type FilaExistente,
} from './incremental.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let malas = 0;

function comprueba(que: string, condicion: boolean, detalle = ''): void {
  if (condicion) {
    console.log(`  ✓ ${que}`);
  } else {
    console.log(`  ✗ ${que}${detalle ? `  ${detalle}` : ''}`);
    malas++;
  }
}

/*
 * Las que NO se comparan, y por qué. Están aquí y no sueltas en el código
 * porque una exclusión sin motivo escrito es indistinguible de un olvido.
 */
const EXCLUIDAS = new Map([
  ['source', 'es parte de la clave'],
  ['source_id', 'es parte de la clave'],
  ['location', 'copia de las coordenadas del museo; cambia por museo, no por obra'],
]);

// ---------------------------------------------------------------------------
console.log('\nLa lista de campos comparados sigue completa');
// ---------------------------------------------------------------------------

const fuente = await readFile(join(HERE, 'db.ts'), 'utf8');

/*
 * Las claves del objeto que `upsertArtworks` mete en `rows`. Se recorta entre
 * el `rows.push({` y su cierre, y se cogen las claves del primer nivel. Leer el
 * código en vez de mantener una segunda lista a mano es justamente el punto:
 * una lista a mano es lo que se queda atrás.
 */
const desde = fuente.indexOf('rows.push({');
const hasta = fuente.indexOf('\n    });', desde);

if (desde === -1 || hasta === -1) {
  console.log('  ✗ no se encuentra el `rows.push({...})` de upsertArtworks');
  console.log('     (si se ha reescrito, hay que actualizar esta comprobación)');
  malas++;
} else {
  const cuerpo = fuente.slice(desde, hasta);
  const escritas = new Set(
    [...cuerpo.matchAll(/^\s{6}([a-z_]+):/gm)].map((m) => m[1]!),
  );

  comprueba(
    `se leen las columnas que escribe upsertArtworks (${escritas.size})`,
    escritas.size > 10,
    `solo se han encontrado ${escritas.size}`,
  );

  const comparadas = new Set<string>(CAMPOS_COMPARADOS);

  const sinComparar = [...escritas].filter(
    (c) => !comparadas.has(c) && !EXCLUIDAS.has(c),
  );
  comprueba(
    'ninguna columna escrita se queda sin comparar',
    sinComparar.length === 0,
    `sin comparar: ${sinComparar.join(', ')} — añádelas a CAMPOS_COMPARADOS o a EXCLUIDAS con su motivo`,
  );

  const fantasmas = [...comparadas].filter((c) => !escritas.has(c));
  comprueba(
    'no se compara ninguna columna que ya no se escriba',
    fantasmas.length === 0,
    `sobran: ${fantasmas.join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\nComparar valores como los compara Postgres');
// ---------------------------------------------------------------------------

comprueba('null y undefined son lo mismo', mismoValor(null, undefined));
comprueba('null no es igual a 0', !mismoValor(null, 0));
comprueba('null no es igual a cadena vacía', !mismoValor(null, ''));
comprueba('46 y "46" son el mismo cuadro', mismoValor(46, '46'));
comprueba('46 y 46.0 son el mismo cuadro', mismoValor(46, 46.0));
comprueba('46 y 47 no lo son', !mismoValor(46, 47));
comprueba('dos títulos iguales', mismoValor('El columpio', 'El columpio'));
comprueba('dos títulos distintos', !mismoValor('El columpio', 'La maja'));

// ---------------------------------------------------------------------------
console.log('\nDecidir qué hay que escribir');
// ---------------------------------------------------------------------------

const base = (extra: Record<string, unknown> = {}) => ({
  source: 'wikidata',
  source_id: 'Q1',
  title: 'El columpio',
  image_url: 'https://ejemplo/a.jpg',
  status: 'published',
  ...extra,
});

function existente(extra: Partial<FilaExistente> = {}): Map<string, FilaExistente> {
  const valores: Record<string, unknown> = {};
  for (const campo of CAMPOS_COMPARADOS) valores[campo] = null;
  valores.title = 'El columpio';
  valores.image_url = 'https://ejemplo/a.jpg';
  valores.status = 'published';

  return new Map([[clave('wikidata', 'Q1'), {
    id: 7,
    lockedFields: new Set<string>(),
    statusLocked: false,
    valores,
    movimientos: new Set<number>(),
    tieneTraducciones: true,
    ...extra,
  }]]);
}

{
  const p = planificar([base()], [[]], new Map());
  comprueba('una obra que no está se inserta', p.nuevas === 1 && p.filas.length === 1);
  comprueba('  y se le escriben los enlaces', p.enlaces.length === 1);
}

{
  const p = planificar([base()], [[]], existente());
  comprueba('una obra idéntica no se toca', p.iguales === 1 && p.filas.length === 0);
  comprueba('  ni sus enlaces', p.enlaces.length === 0);
  comprueba('  y se conoce su id sin volver a escribirla', p.idsConocidos.get(0) === 7);
}

{
  const p = planificar([base({ image_url: 'https://ejemplo/NUEVA.jpg' })], [[]], existente());
  comprueba('una imagen nueva sí se escribe', p.filas.length === 1 && p.iguales === 0);
  comprueba('  y se dice qué campo cambió', p.porCampo.get('image_url') === 1);
}

{
  // El caso que costó ver: sin esto, la fila se reescribiría en cada pasada
  // para que el disparador la revirtiera, eternamente.
  const p = planificar(
    [base({ title: 'Lo que dice Wikidata' })],
    [[]],
    existente({ lockedFields: new Set(['title']) }),
  );
  comprueba('un campo corregido a mano no cuenta como diferencia', p.iguales === 1);
}

{
  const p = planificar(
    [base({ status: 'pending', pending_reason: 'image_missing' })],
    [[]],
    existente({ statusLocked: true }),
  );
  comprueba('con el estado bloqueado, el estado no cuenta como diferencia', p.iguales === 1);
}

{
  // Los movimientos no están en la fila: si no se comparasen aparte, añadir
  // «Cubismo» a un cuadro sería un cambio invisible.
  const p = planificar([base()], [[3]], existente());
  comprueba('un movimiento nuevo se detecta', p.enlaces.length === 1);
  comprueba('  sin reescribir la fila de la obra', p.filas.length === 0);
}

{
  const p = planificar([base()], [[]], existente({ movimientos: new Set([3]) }));
  comprueba('un movimiento retirado también se detecta', p.enlaces.length === 1);
}

{
  // Publicada por `promote` entre dos ingestas: la fila es la que sería, pero
  // nunca se le escribieron los textos.
  const p = planificar([base()], [[]], existente({ tieneTraducciones: false }));
  comprueba('una publicada sin traducciones las recibe', p.traducciones.length === 1);
  comprueba('  sin reescribir su fila', p.filas.length === 0);
}

{
  const p = planificar(
    [base({ status: 'pending' })], [[]],
    existente({ tieneTraducciones: false, valores: { ...existente().get(clave('wikidata', 'Q1'))!.valores, status: 'pending' } }),
  );
  comprueba('una pendiente sin traducciones se deja en paz', p.traducciones.length === 0 && p.iguales === 1);
}

// ---------------------------------------------------------------------------
console.log(malas === 0 ? '\nTodo bien.\n' : `\n${malas} fallo(s).\n`);
process.exit(malas === 0 ? 0 : 1);
