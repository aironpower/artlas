/**
 * Genera `data/museums.seed.json` verificando cada museo contra Wikidata.
 *
 * Por qué existe este script en vez de una lista de QIDs escrita a mano: un
 * QID equivocado no falla, simplemente devuelve cero obras, y el museo
 * desaparece del mapa sin que nadie se entere. Aquí cada entrada se resuelve
 * por nombre, se comprueba que tiene coordenadas y se cuenta cuántas obras
 * notables tiene antes de darla por buena.
 *
 * Por qué no se descubren los museos con una sola consulta: agregar sobre
 * todas las pinturas de Wikidata para rankear museos revienta el endpoint
 * (probado: timeout a los 65 s). Acotado por museo es instantáneo, así que
 * partimos de una lista de nombres y verificamos uno a uno.
 *
 *   npx tsx src/build-seed.ts
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchJson, RateLimiter } from './util/http.js';
import { expandHolders } from './sources/wikidata.js';

const USER_AGENT =
  process.env.WIKIDATA_USER_AGENT ?? 'Artlas/0.1 (https://github.com/artlas; contacto@artlas.app)';

const limiter = new RateLimiter(1200);

/** Museos de partida, por nombre. El QID lo resuelve el script. */
const CANDIDATES: { search: string; api?: 'aic' | 'met' | 'harvard' }[] = [
  { search: 'Louvre Museum' },
  { search: 'Museo del Prado' },
  { search: 'Metropolitan Museum of Art', api: 'met' },
  { search: 'Art Institute of Chicago', api: 'aic' },
  { search: 'Harvard Art Museums', api: 'harvard' },
  { search: 'Uffizi Gallery' },
  { search: 'Rijksmuseum' },
  { search: 'Museum of Modern Art' },
  { search: 'Tate Britain' },
  { search: 'Tate Modern' },
  { search: 'National Gallery London' },
  { search: 'National Gallery of Art Washington' },
  { search: 'Kunsthistorisches Museum' },
  { search: 'Hermitage Museum' },
  { search: 'Museo Nacional Centro de Arte Reina Sofía' },
  { search: 'Museo Thyssen-Bornemisza' },
  { search: 'Van Gogh Museum' },
  { search: "Musée d'Orsay" },
  { search: 'Musee Picasso' },
  { search: 'Museu Nacional d\'Art de Catalunya' },
  { search: 'Galleria Borghese' },
  { search: 'Vatican Museums' },
  { search: 'Gemäldegalerie Berlin' },
  { search: 'Alte Pinakothek' },
  { search: 'Neue Pinakothek' },
  { search: 'Städel Museum' },
  { search: 'Mauritshuis' },
  { search: 'Royal Museums of Fine Arts of Belgium' },
  { search: 'Nationalmuseum Stockholm' },
  { search: 'Statens Museum for Kunst' },
  { search: 'Galleria dell\'Accademia' },
  { search: 'Pinacoteca di Brera' },
  { search: 'Museo di Capodimonte' },
  { search: 'National Gallery of Victoria' },
  { search: 'Museum of Fine Arts Boston' },
  { search: 'Philadelphia Museum of Art' },
  { search: 'J. Paul Getty Museum' },
  { search: 'Guggenheim Museum' },
  { search: 'Whitney Museum of American Art' },
  { search: 'National Museum of Western Art' },
  { search: 'Museu de Arte de São Paulo' },
  { search: 'National Gallery of Canada' },
  { search: 'Art Gallery of Ontario' },
  { search: 'Museo Nacional de Bellas Artes' },
  { search: 'Museo Soumaya' },
  { search: 'Wallace Collection' },
  { search: 'Courtauld Gallery' },
  { search: 'Scottish National Gallery' },
  { search: 'Kunstmuseum Basel' },
  { search: 'Museo di Palazzo Vecchio' },
];

interface SearchResult { search: { id: string; label: string; description?: string }[] }

/**
 * Resuelve un nombre de museo a su QID.
 *
 * `wbsearchentities` compara por PREFIJO de etiqueta o alias, no es una
 * búsqueda difusa. Eso hace que fallen justo los nombres que uno escribiría
 * de forma natural, con la ciudad como desambiguador:
 *
 *   "Musée Picasso Paris"   -> sin resultado
 *   "Musee Picasso"         -> Q743206  ✓
 *   "Picasso Museum Paris"  -> sin resultado
 *
 * Por eso probamos el nombre completo y, si falla, vamos quitando palabras
 * por el final. Sin esto se caían de la semilla museos que existen y están
 * perfectamente descritos en Wikidata, con el mensaje engañoso de "sin
 * resultado en Wikidata".
 */
async function resolveQid(name: string): Promise<string | null> {
  const words = name.split(/\s+/);

  // OJO con el límite del bucle: `take >= 2` parecía razonable (buscar por
  // media palabra no tiene sentido) pero deja fuera los nombres de UNA sola
  // palabra, que nunca entran en el bucle. Se cayeron de la semilla el
  // Rijksmuseum y el Mauritshuis, que resuelven perfectamente a la primera.
  for (let take = words.length; take >= 1; take--) {
    const attempt = words.slice(0, take).join(' ');
    await limiter.acquire();

    const url =
      'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*' +
      `&language=en&uselang=en&type=item&limit=5&search=${encodeURIComponent(attempt)}`;

    const res = await fetchJson<SearchResult>(url, {
      headers: { 'User-Agent': USER_AGENT },
      label: `buscar "${attempt}"`,
    });

    const hit = res.search[0];
    if (hit) {
      if (take < words.length) {
        console.log(`     ("${name}" no coincide; resuelto como "${attempt}")`);
      }
      return hit.id;
    }
  }

  return null;
}

interface Verified {
  qid: string;
  name: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
  notableWorks: number;
  api?: string;
}

/** Comprueba que el QID es un museo real con coordenadas y cuenta sus obras. */
async function verify(qid: string, api?: string): Promise<Verified | null> {
  await limiter.acquire();

  const query = `
    SELECT ?mLabel ?cityLabel ?countryLabel ?coord WHERE {
      BIND(wd:${qid} AS ?m)
      ?m wdt:P625 ?coord .
      OPTIONAL { ?m wdt:P131 ?city }
      OPTIONAL { ?m wdt:P17 ?country }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    } LIMIT 1`;

  const meta = await sparqlRows(query, `verificar ${qid}`);
  const row = meta[0];
  if (!row?.coord) return null;

  const m = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(row.coord);

  return {
    qid,
    name: row.mLabel ?? qid,
    city: row.cityLabel,
    country: row.countryLabel,
    lat: m?.[2] ? Number(m[2]) : undefined,
    lng: m?.[1] ? Number(m[1]) : undefined,
    notableWorks: await countNotableWorks(qid),
    api,
  };
}

/**
 * Estimación de obras notables del museo. Es solo para ordenar la semilla.
 *
 * Dos precauciones aprendidas a base de timeouts:
 *
 * 1. NO se filtra por `wdt:P18` (tener imagen). Con 38 holders el Met
 *    aguanta el conteo en 9 s, pero al añadir la imagen se va a timeout.
 *    Como es una estimación para ordenar, la precisión no compensa el coste.
 *
 * 2. Un fallo devuelve -1 ("desconocido"), NUNCA descarta el museo. Tratar el
 *    timeout como "0 obras" expulsaría de la semilla justo a los museos más
 *    grandes, que son los que más tardan en contarse.
 *
 * 3. Presupuesto corto (25 s, 1 reintento) en vez del genérico (75 s, 4). Con
 *    el genérico, un solo museo que no se deja contar bloquea el script cinco
 *    minutos; multiplicado por los museos grandes, la semilla tardaba una hora
 *    en generarse. Es un dato opcional: si no sale rápido, no sale.
 */
async function countNotableWorks(qid: string): Promise<number> {
  try {
    const holders = await expandHolders(qid);
    await limiter.acquire();

    const rows = await sparqlRows(`
      SELECT (COUNT(DISTINCT ?work) AS ?n) WHERE {
        VALUES ?holder { ${holders.map((h) => `wd:${h}`).join(' ')} }
        { ?work wdt:P195 ?holder } UNION { ?work wdt:P276 ?holder }
        ?work wdt:P31 wd:Q3305213 ; wikibase:sitelinks ?s .
        FILTER(?s >= 5)
      }`, `contar ${qid}`, { timeoutMs: 25_000, retries: 1 });

    return Number(rows[0]?.n ?? 0);
  } catch {
    console.warn(`     (no se pudo contar ${qid}; se acepta igualmente)`);
    return -1;
  }
}

async function sparqlRows(
  query: string,
  label: string,
  budget: { timeoutMs?: number; retries?: number } = {},
): Promise<Record<string, string>[]> {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetchJson<{ results: { bindings: Record<string, { value: string }>[] } }>(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    timeoutMs: budget.timeoutMs ?? 75_000,
    retries: budget.retries,
    label,
  });
  return res.results.bindings.map((b) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])),
  );
}

async function main() {
  const verified: Verified[] = [];
  const rejected: string[] = [];

  for (const candidate of CANDIDATES) {
    try {
      const qid = await resolveQid(candidate.search);
      if (!qid) {
        rejected.push(`${candidate.search} — sin resultado en Wikidata`);
        continue;
      }

      const result = await verify(qid, candidate.api);
      if (!result) {
        rejected.push(`${candidate.search} (${qid}) — sin coordenadas`);
        continue;
      }

      if (result.notableWorks === 0) {
        rejected.push(`${candidate.search} (${qid}) — 0 obras notables`);
        continue;
      }

      verified.push(result);
      console.log(
        `  ✓ ${result.qid.padEnd(10)} ${result.name.slice(0, 38).padEnd(40)} ` +
        `${result.notableWorks < 0 ? '    ?' : String(result.notableWorks).padStart(5)} obras  ` +
        `${result.city ?? ''}`,
      );
    } catch (err) {
      rejected.push(`${candidate.search} — ${(err as Error).message}`);
    }
  }

  verified.sort((a, b) => b.notableWorks - a.notableWorks);

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'museums.seed.json');
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Generado por src/build-seed.ts. Cada QID está verificado contra Wikidata.',
    totalNotableWorks: verified.reduce((sum, m) => sum + Math.max(m.notableWorks, 0), 0),
        museums: verified,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`\n${verified.length} museos verificados -> data/museums.seed.json`);
  console.log(`Total de obras notables alcanzables: ${verified.reduce((s, m) => s + m.notableWorks, 0)}`);

  if (rejected.length > 0) {
    console.log(`\n${rejected.length} descartados:`);
    for (const r of rejected) console.log(`  ✗ ${r}`);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
