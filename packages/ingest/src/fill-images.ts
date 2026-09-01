#!/usr/bin/env node
/**
 * Busca imágenes para las obras que esperan, en la API del propio museo.
 *
 *   npm run fill-images              enseña qué encontraría, sin tocar nada
 *   npm run fill-images -- --apply   escribe las imágenes encontradas
 *
 * Por qué existe: de las 61.108 obras que esperan, TODAS esperan por lo mismo
 * —no tienen imagen— y 22.575 están en dominio público. No son arte del siglo
 * XX inaccesible: son obras libres que simplemente no tienen foto en Wikimedia
 * Commons, y que sus museos sí publican.
 *
 * Y por qué no Europeana, que era el plan inicial: se comprobó y no las tiene.
 * Ni el Guernica, ni Nighthawks, ni La persistencia de la memoria; de Warhol
 * hay diez imágenes en todo su catálogo. Es un agregador de bibliotecas y
 * archivos, no de grandes museos de arte.
 *
 * El cruce va por número de inventario y no por título, porque los títulos del
 * museo están en su idioma y los nuestros vienen de Wikidata en inglés.
 * Wikidata publica ese número en P217.
 *
 * Esto NO publica nada: solo rellena la imagen. Quien decide el estado es
 * `npm run promote`, que aplica las mismas reglas que la puerta de entrada.
 */

import pg from 'pg';
import { fetchCatalogue, iiifImage, inventoryKey, NATIONALMUSEUM_QID } from './sources/nationalmuseum.js';

const aplicar = process.argv.includes('--apply');
const UA = process.env.WIKIDATA_USER_AGENT ?? 'Artlas/0.1 (contacto@artlas.app)';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\nFalta DATABASE_URL en el .env de la raíz.\n');
  process.exit(1);
}

/**
 * Pide a Wikidata el número de inventario (P217) de un puñado de obras.
 *
 * Se consulta aquí y no se lee del catálogo porque las obras se ingirieron
 * antes de que P217 formara parte de la consulta. Las ingestas futuras ya lo
 * traerán y este paso podrá leerlo de la base.
 */
async function inventoryNumbers(qids: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  for (let i = 0; i < qids.length; i += 200) {
    const lote = qids.slice(i, i + 200);
    const query = `
      SELECT ?w ?inv WHERE {
        VALUES ?w { ${lote.map((q) => `wd:${q}`).join(' ')} }
        ?w wdt:P217 ?inv .
      }`;

    const res = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`,
      { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });

    if (res.ok) {
      const json = await res.json() as { results: { bindings: Record<string, { value: string }>[] } };
      for (const b of json.results.bindings) {
        const qid = b.w?.value.split('/').pop();
        if (qid && b.inv) found.set(qid, b.inv.value);
      }
    }

    process.stdout.write(`  inventarios: ${Math.min(i + 200, qids.length)}/${qids.length}\r`);
    await new Promise((r) => setTimeout(r, 1500));   // WDQS es gratis y compartido
  }

  return found;
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

try {
  const { rows: pendientes } = await db.query<{ id: number; wikidata_qid: string; title: string }>(`
    select a.id, a.wikidata_qid, a.title
      from artworks a join institutions i on i.id = a.institution_id
     where i.wikidata_qid = $1
       and a.status = 'pending'
       and a.image_url is null
       and a.wikidata_qid is not null`, [NATIONALMUSEUM_QID]);

  console.log(`\nNationalmuseum: ${pendientes.length} obras esperando imagen.`);
  if (!aplicar) console.log('MODO SECO: no se escribe nada. Añade --apply para ejecutarlo.\n');

  if (pendientes.length === 0) process.exit(0);

  console.log('\n1. Pidiendo a Wikidata el número de inventario de cada una…');
  const inventarios = await inventoryNumbers(pendientes.map((p) => p.wikidata_qid));
  console.log(`\n   ${inventarios.size} de ${pendientes.length} tienen P217 en Wikidata.`);

  console.log('\n2. Descargando el catálogo del museo (no admite búsqueda: hay que traerlo entero)…');
  const porInventario = new Map<string, { iiifBase: string; license?: string; credit?: string }>();

  for await (const obj of fetchCatalogue(UA, (page, total, kept) => {
    if (page % 50 === 0 || page === total) {
      process.stdout.write(`   página ${page}/${total}, ${kept} objetos con imagen e inventario\r`);
    }
  })) {
    porInventario.set(obj.inventoryKey, {
      iiifBase: obj.iiifBase, license: obj.license, credit: obj.credit,
    });
  }

  console.log(`\n   ${porInventario.size} objetos suyos con imagen y número de inventario.`);

  console.log('\n3. Cruzando…');
  const encontradas: { id: number; imageUrl: string; iiifBase: string; license?: string }[] = [];

  for (const obra of pendientes) {
    const inv = inventarios.get(obra.wikidata_qid);
    if (!inv) continue;

    const match = porInventario.get(inventoryKey(inv));
    if (!match) continue;

    encontradas.push({
      id: obra.id,
      imageUrl: iiifImage(match.iiifBase),
      // Sin la barra final, que es como la deja el museo y sobra al componer.
      iiifBase: match.iiifBase.replace(/^http:/, 'https:').replace(/\/+$/, ''),
      license: match.credit ?? match.license ?? 'Nationalmuseum, Estocolmo',
    });
  }

  console.log(`\n   ${encontradas.length} obras encontradas con imagen.`);

  /*
   * 4. Que carguen de verdad, antes de escribir miles.
   *
   * Existe porque el 31 de agosto de 2026 este paso construía las URLs con
   * ancho 1280 y su servidor devuelve 501 a ese ancho SIEMPRE. Sin esta
   * comprobación se habrían escrito ~11.000 imágenes rotas, y el fallo no se
   * habría visto hasta que alguien abriera una ficha: una obra con imagen que
   * no carga es peor que una obra esperando, porque ya no vuelve a esta cola.
   *
   * Se prueban veinte repartidas, no todas: es una comprobación de que la
   * FORMA de la URL es buena, no un inventario.
   */
  if (encontradas.length > 0) {
    const paso = Math.max(1, Math.floor(encontradas.length / 20));
    const muestra = encontradas.filter((_, i) => i % paso === 0).slice(0, 20);
    let rotas = 0;

    console.log(`\n4. Comprobando ${muestra.length} imágenes repartidas…`);
    for (const e of muestra) {
      const res = await fetch(e.imageUrl, { headers: { 'User-Agent': UA } }).catch(() => null);
      if (!res?.ok) {
        rotas++;
        if (rotas <= 3) console.log(`   ✗ ${res?.status ?? 'sin respuesta'}  ${e.imageUrl}`);
      }
    }

    if (rotas > 0) {
      throw new Error(
        `${rotas} de ${muestra.length} imágenes no cargan. No se escribe nada: ` +
        'arregla cómo se construye la URL antes de repetir.');
    }
    console.log(`   las ${muestra.length} cargan.`);
  }

  if (encontradas.length === 0 || !aplicar) {
    console.log(aplicar ? '' : '\nModo seco: no se ha escrito nada.\n');
    process.exit(0);
  }

  await db.query('begin');
  for (const e of encontradas) {
    await db.query(
      `update artworks set image_url = $2, iiif_base = $3, image_license = $4 where id = $1`,
      [e.id, e.imageUrl, e.iiifBase, e.license]);
  }
  await db.query('commit');

  console.log(`\n${encontradas.length} imágenes escritas.`);
  console.log('Ahora `npm run promote -- --apply` las publica.\n');
} catch (err) {
  await db.query('rollback').catch(() => { /* ya abortada */ });
  console.error(`\nError, no se ha cambiado nada: ${(err as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await db.end();
}
