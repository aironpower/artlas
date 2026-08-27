/**
 * Comprobación de que las fuentes externas siguen respondiendo como esperamos.
 *
 *   npx tsx src/verify-sources.ts
 *
 * No es un test unitario: llama a las APIs reales. Sirve para responder rápido
 * a "¿esto está roto por mi cambio o porque Wikidata cambió algo?", que con
 * cuatro APIs de terceros es una pregunta constante.
 */

import { fetchInstitution, expandHolders, fetchArtworks } from './sources/wikidata.js';
import { enrichFromAic, enrichFromMet } from './sources/museum-apis.js';
import type { CanonicalArtwork } from './types.js';

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const stub = (over: Partial<CanonicalArtwork>): CanonicalArtwork => ({
  category: 'painting', source: 'wikidata', sourceId: 'test', title: '', ...over,
});

console.log('\nWikidata');

const louvre = await fetchInstitution('Q19675');
check('metadatos del museo', louvre?.name.includes('Louvre') ?? false, louvre?.name);
check('coordenadas', louvre?.lat !== undefined, `${louvre?.lat}, ${louvre?.lng}`);

// El Louvre cuelga sus pinturas del Departamento de Pinturas, no de sí mismo:
// si esto devuelve 1, la expansión se rompió y el museo saldrá casi vacío.
const holders = await expandHolders('Q19675');
check('expansión a departamentos', holders.length > 10, `${holders.length} sub-entidades`);

const works: CanonicalArtwork[] = [];
for await (const w of fetchArtworks(
  { qid: 'Q19675', name: 'Louvre' }, louvre!, { minNotability: 20, limit: 5 },
)) works.push(w);

check('descarga de obras', works.length > 0, `${works.length} obras`);
check('ordenadas por notoriedad', (works[0]?.notability ?? 0) >= 20,
      `la primera tiene ${works[0]?.notability} sitelinks`);
check('con autor', works.some((w) => w.artist?.name), works[0]?.artist?.name);
check('con año', works.some((w) => w.yearStart !== undefined), works[0]?.dateDisplay);
check('con imagen', works.every((w) => w.imageUrl));

console.log('\nThe Met');

const met = await enrichFromMet(stub({
  wikidataQid: 'Q18689458', title: 'Wheat Field with Cypresses',
  yearStart: 1889, artist: { name: 'Vincent van Gogh' },
}));
check('cruce exacto por QID', met !== null);
check('sala concreta', Boolean(met?.gallery), met?.gallery);
check('dimensiones desde texto libre', met?.heightCm === 73.2, `${met?.heightCm}cm`);

console.log('\nArt Institute of Chicago');

const aic = await enrichFromAic(stub({
  title: 'The Bedroom', yearStart: 1889, artist: { name: 'Vincent van Gogh' },
}));
check('emparejamiento por título + autor', aic !== null);
check('IIIF', Boolean(aic?.iiifBase), aic?.iiifBase?.slice(0, 45));
check('movimiento', aic?.movementName === 'Post-Impressionism', aic?.movementName);

// Control negativo: AIC NO tiene este cuadro, pero su búsqueda difusa devuelve
// un "Wheatfield" de Braque como primer resultado. Si esto deja de dar null,
// el catálogo se está llenando de datos de obras equivocadas.
const trap = await enrichFromAic(stub({
  title: 'Wheat Field with Cypresses', yearStart: 1889, artist: { name: 'Vincent van Gogh' },
}));
check('rechaza el falso positivo de Braque', trap === null);

console.log(failures === 0 ? '\nTodo correcto.\n' : `\n${failures} comprobaciones fallidas.\n`);
process.exit(failures === 0 ? 0 : 1);
