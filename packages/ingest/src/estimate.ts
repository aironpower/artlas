/** Estima el tamaño del catálogo según el umbral de notoriedad. */
import { expandHolders } from './sources/wikidata.js';
import { fetchJson } from './util/http.js';

const UA = 'Artlas/0.1 (manuel@softie.dev)';
const THRESHOLDS = [1, 2, 3, 5, 8];

async function count(holders: string[], min: number): Promise<number | null> {
  const q = `SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE {
    VALUES ?h { ${holders.map(h => `wd:${h}`).join(' ')} }
    { ?w wdt:P195 ?h } UNION { ?w wdt:P276 ?h }
    ?w wdt:P31 wd:Q3305213 ; wikibase:sitelinks ?s . FILTER(?s >= ${min}) }`;
  try {
    const r = await fetchJson<any>(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}&format=json`,
      { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
        timeoutMs: 30_000, retries: 1, label: `t${min}` });
    return Number(r.results.bindings[0]?.n?.value ?? 0);
  } catch { return null; }
}

const museums: [string, string][] = [
  ['Louvre', 'Q19675'], ['Prado', 'Q160112'], ['National Gallery', 'Q180788'],
];

console.log(['museo'.padEnd(18), ...THRESHOLDS.map(t => `>=${t}`.padStart(7))].join(''));
const totals = new Map(THRESHOLDS.map(t => [t, 0]));

for (const [name, qid] of museums) {
  const holders = await expandHolders(qid);
  const row = [name.padEnd(18)];
  for (const t of THRESHOLDS) {
    const n = await count(holders, t);
    if (n !== null) totals.set(t, totals.get(t)! + n);
    row.push(String(n ?? '—').padStart(7));
  }
  console.log(row.join(''));
}

console.log(['SUMA'.padEnd(18), ...THRESHOLDS.map(t => String(totals.get(t)).padStart(7))].join(''));
const base = totals.get(5)!;
console.log('\nFactor respecto al umbral 5 (el actual, que dio 2.241 en 47 museos):');
for (const t of THRESHOLDS) {
  const f = totals.get(t)! / base;
  console.log(`  umbral ${t}: ×${f.toFixed(2)}  ->  ~${Math.round(2241 * f).toLocaleString('es')} obras`);
}
