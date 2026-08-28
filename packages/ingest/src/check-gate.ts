/**
 * Comprueba que el clasificador de entrada sigue haciendo su trabajo.
 *
 *   npm run check-gate
 *
 * No toca ni la red ni la base de datos: las reglas son puras, y esa es
 * justamente la razón de que se pueda comprobar así. Los casos no son
 * inventados, son los defectos que aparecieron de verdad en el catálogo — el
 * "Google Maps pin", la autoría `genid`, el "17th Century" como movimiento— y
 * están aquí para que un cambio en las reglas no los vuelva a colar sin que
 * nadie se entere.
 *
 * Lo que más se vigila aquí es la distinción entre `pending` y `rejected`: que
 * a una obra le falte la imagen NUNCA puede acabar tirándola, porque ese es
 * exactamente el catálogo de arte del siglo XX que queremos guardar.
 */

import { classify, rightsFor } from './audit/gate.js';
import type { CanonicalArtwork } from './types.js';

const PRADO = { name: 'Museo del Prado', lat: 40.41, lng: -3.69 };
const base = { category: 'painting' as const, source: 'wikidata' as const, institution: PRADO };
const img = (f: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${f}`;

let fallos = 0;

function comprueba(descripcion: string, condicion: boolean) {
  console.log(`  ${condicion ? '✓' : '✗'} ${descripcion}`);
  if (!condicion) fallos++;
}

const casos: CanonicalArtwork[] = [
  { ...base, sourceId: 'ok', title: 'Las Meninas', imageUrl: img('Las_Meninas.jpg'),
    artist: { name: 'Diego Velázquez', wikidataQid: 'Q297', deathYear: 1660 } },

  { ...base, sourceId: 'svg', title: 'Google Maps pin', imageUrl: img('Google%20Maps%20pin.svg') },

  { ...base, sourceId: 'genid', title: 'Stele of the Vultures', imageUrl: img('Stele.jpg'),
    artist: { name: 'http://www.wikidata.org/.well-known/genid/18b271e064221ace13b71bdc' } },

  { ...base, sourceId: 'epoca', title: 'Retrato anónimo', imageUrl: img('Retrato.jpg'),
    movements: [{ name: '17th Century' }, { name: 'Baroque', wikidataQid: 'Q37853' }] },

  { ...base, sourceId: 'sin-imagen', title: 'Guernica sin foto',
    artist: { name: 'Pablo Picasso', wikidataQid: 'Q5593', deathYear: 1973 } },

  // Wikidata dice que es libre aunque el autor muriera hace poco: manda la fuente.
  { ...base, sourceId: 'declarada-libre', title: 'Obra liberada por su autor',
    imageUrl: img('Libre.jpg'), copyrightStatus: 'public_domain',
    artist: { name: 'Autor Reciente', deathYear: 2010 } },

  // Y al revés: autor antiguo pero la fuente la declara en derechos.
  { ...base, sourceId: 'declarada-cerrada', title: 'Obra con derechos vivos',
    imageUrl: img('Cerrada.jpg'), copyrightStatus: 'in_copyright',
    artist: { name: 'Autor Antiguo', deathYear: 1800 } },

  { ...base, sourceId: 'titulo-url', title: 'http://www.wikidata.org/entity/Q999',
    imageUrl: img('X.jpg') },

  { category: 'painting', source: 'wikidata', sourceId: 'sin-museo', title: 'Sin museo',
    imageUrl: img('Y.jpg') },
];

const r = classify(casos);
const fila = (id: string) => r.rows.find((x) => x.work.sourceId === id);

console.log('\nClasificador de entrada\n');

comprueba('una obra correcta se publica, con su artista intacto',
  fila('ok')?.status === 'published' && fila('ok')?.work.artist?.name === 'Diego Velázquez');

comprueba('una obra en dominio público se marca como tal',
  fila('ok')?.rightsStatus === 'public_domain');

comprueba('un SVG se rechaza (no es una obra, es un icono)',
  fila('svg')?.status === 'rejected' && fila('svg')?.reason === 'image_is_vector');

comprueba('un título que es una URL se rechaza',
  fila('titulo-url')?.status === 'rejected' && fila('titulo-url')?.reason === 'title_is_url');

// El corazón del asunto: sin imagen se ESPERA, no se tira.
comprueba('sin imagen queda PENDIENTE, no rechazada',
  fila('sin-imagen')?.status === 'pending' && fila('sin-imagen')?.reason === 'image_missing');

comprueba('un Picasso se marca en derechos, no en dominio público',
  fila('sin-imagen')?.rightsStatus === 'in_copyright');

comprueba('sin museo queda pendiente, no rechazada',
  fila('sin-museo')?.status === 'pending' && fila('sin-museo')?.reason === 'institution_missing');

comprueba('la autoría anónima entra SIN artista, no con una URL por nombre',
  fila('genid')?.status === 'published' && fila('genid')?.work.artist === undefined);

comprueba('sin fecha de muerte los derechos quedan en "desconocido"',
  fila('genid')?.rightsStatus === 'unknown');

comprueba('una época se descarta como movimiento y la obra se publica igual',
  fila('epoca')?.status === 'published'
  && fila('epoca')?.work.movements?.length === 1
  && fila('epoca')?.work.movements?.[0]?.name === 'Baroque');

comprueba('cada reparación queda anotada', r.repaired.length === 2);

comprueba('NINGUNA obra se pierde por el camino', r.rows.length === casos.length);

// La regla de los 70 años, que hace crecer el catálogo cada 1 de enero.
const esteAno = new Date().getFullYear();
comprueba('la regla de los 70 años se calcula con el año en curso',
  rightsFor(undefined, esteAno - 71) === 'public_domain'
  && rightsFor(undefined, esteAno - 69) === 'in_copyright');

comprueba('lo que declara la fuente manda sobre la fecha de muerte',
  fila('declarada-libre')?.rightsStatus === 'public_domain'
  && fila('declarada-cerrada')?.rightsStatus === 'in_copyright');

console.log(fallos === 0
  ? '\nEl clasificador funciona.\n'
  : `\n${fallos} comprobaciones fallan.\n`);

process.exit(fallos === 0 ? 0 : 1);
