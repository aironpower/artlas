import { notFound } from 'next/navigation';
import { isLang, t, formatNumber, type Lang } from '@/lib/i18n';
import { searchArtworks, listMovements, listCountries, listCities, BusquedaDemasiadoAncha } from '@/lib/data';
import { path } from '@/lib/routes';
import ArtworkGrid from '@/components/ArtworkGrid';
import Paginacion, { leerPagina } from '@/components/Paginacion';
import SelectQueEnvia from '@/components/SelectQueEnvia';

export const revalidate = 3600;

interface Params { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> }

/*
 * Obras por página. Antes esto era un TOPE de 60 y la cabecera decía "60+"
 * para no mentir: el catálogo tenía 119 Rembrandt y la web enseñaba 60 sin
 * manera de ver el resto. Con `p_offset` (0023) ya no es un techo.
 *
 * Lo que sigue sin saberse es el total: contar las coincidencias de una
 * búsqueda con comodines en cada página se paga en los 3 s de `statement_
 * timeout` del rol `anon`. Por eso se pide una obra de más —si vuelve, hay
 * página siguiente— en vez de contar.
 */
const POR_PAGINA = 36;

export default async function SearchPage({ params, searchParams }: Params) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const sp = await searchParams;
  const pagina = leerPagina(sp.p);

  /*
   * Las ciudades se piden ANTES de buscar, y por eso no van en el `Promise.all`
   * de abajo: hace falta saber si la ciudad elegida pertenece al país elegido.
   *
   * Sin esta comprobación, cambiar de país dejaba la ciudad anterior colgada en
   * la URL —«pais=FR&ciudad=Madrid»— y la búsqueda devolvía cero resultados sin
   * decir por qué. Cuesta una ida y vuelta más, y solo cuando hay país elegido.
   */
  const cities = sp.pais ? await listCities(lang, sp.pais) : [];
  const ciudad = cities.some((c) => c.value === sp.ciudad) ? sp.ciudad : undefined;

  const filters = {
    query: sp.q,
    movement: sp.mov,
    artist: sp.artista,
    country: sp.pais,
    city: ciudad,
    category: sp.cat,
    yearFrom: sp.desde ? Number(sp.desde) : undefined,
    yearTo: sp.hasta ? Number(sp.hasta) : undefined,
    limit: POR_PAGINA + 1,
    offset: (pagina - 1) * POR_PAGINA,
  };

  /*
   * La búsqueda puede no llegar a tiempo y los desplegables sí. Por eso se
   * recoge aparte: si cayera todo junto, un corte de la base dejaría la
   * pantalla sin filtros, que es justo lo que hace falta para arreglar la
   * búsqueda que ha cortado. Se enseña la página entera, con sus filtros, y
   * en el hueco de los resultados se explica qué ha pasado.
   */
  const [busqueda, movements, countries] = await Promise.all([
    searchArtworks(lang, filters).then(
      (lote) => ({ lote }),
      (e) => {
        if (e instanceof BusquedaDemasiadoAncha) return { lote: [], ancha: true as const };
        throw e;
      },
    ),
    listMovements(lang),
    listCountries(lang),
  ]);

  const lote = busqueda.lote;
  const ancha = 'ancha' in busqueda;
  const results = lote.slice(0, POR_PAGINA);
  const hayMas = lote.length > POR_PAGINA;

  /*
   * Una página más allá del final no es una página vacía: no existe. Se mira
   * lo que ha vuelto y no el contador, que se recalcula al terminar cada
   * ingesta y puede ir un rato por detrás de las filas.
   */
  if (pagina > 1 && lote.length === 0 && !ancha) notFound();


  return (
    <>
      {/*
        * El título decía «Explorar el mapa» y aquí no hay mapa: la clave
        * `explore` es la de la barra de secciones, y se coló. Sin consulta,
        * esta pantalla es el catálogo entero con filtros.
        *
        * Y la cifra decía «36+ obras», que no es un total sino las que caben en
        * una página: en un catálogo de 135.258 no significaba nada. Ahora solo
        * se pone cuando ES el número —una página única, la primera y sin
        * siguiente—; en cuanto hay más páginas, contar las coincidencias de una
        * búsqueda con comodines se paga en el corte de 3 s, así que no se
        * cuenta y lo dice la paginación, que para eso enseña «Página N».
        */}
      <h1 style={{ paddingTop: 26 }}>
        {sp.q ? `“${sp.q}”` : t(lang, 'allArtworks')}
        {!ancha && !hayMas && pagina === 1 && (
          <span className="muted" style={{ fontSize: '1rem', fontWeight: 400, marginLeft: 10 }}>
            {formatNumber(lang, results.length)} {t(lang, 'artworks')}
          </span>
        )}
      </h1>

      {/* Formulario GET, sin JavaScript: los filtros quedan en la URL y por
          tanto se pueden compartir, marcar como favorito e indexar. */}
      <form className="filters" method="get">
        {sp.q && <input type="hidden" name="q" value={sp.q} />}

        <Field label={t(lang, 'movement')}>
          <select name="mov" defaultValue={sp.mov ?? ''}>
            <option value="">—</option>
            {movements.map((m) => (
              <option key={m.slug} value={m.slug}>{m.name} ({m.count})</option>
            ))}
          </select>
        </Field>

        <Field label={t(lang, 'country')}>
          {/* Se aplica al elegir: de él cuelga la lista de ciudades, y
              esperar al botón hacía parecer que el subfiltro no funcionaba. */}
          <SelectQueEnvia name="pais" defaultValue={sp.pais ?? ''}>
            <option value="">—</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name} ({c.count})</option>
            ))}
          </SelectQueEnvia>
        </Field>

        {/*
          * El subfiltro se enseña siempre, aunque esté vacío: apagado y
          * diciendo por qué. Escondiéndolo hasta elegir país, nadie sabría que
          * existe — y un filtro que no se ve es un filtro que no se usa.
          */}
        <Field label={t(lang, 'city')}>
          <select name="ciudad" defaultValue={ciudad ?? ''} disabled={!sp.pais}>
            <option value="">{sp.pais ? '—' : t(lang, 'cityNeedsCountry')}</option>
            {cities.map((c) => (
              <option key={c.value} value={c.value}>{c.name} ({c.count})</option>
            ))}
          </select>
        </Field>

        <Field label={t(lang, 'category')}>
          <select name="cat" defaultValue={sp.cat ?? ''}>
            <option value="">—</option>
            {['painting', 'sculpture', 'drawing', 'print', 'photograph'].map((c) => (
              <option key={c} value={c}>{categoryLabel(lang, c)}</option>
            ))}
          </select>
        </Field>

        <Field label={t(lang, 'from')}>
          <input type="number" name="desde" defaultValue={sp.desde ?? ''} placeholder="1400" />
        </Field>

        <Field label={t(lang, 'to')}>
          <input type="number" name="hasta" defaultValue={sp.hasta ?? ''} placeholder="1900" />
        </Field>

        <button className="btn btn-primary" type="submit">{t(lang, 'filters')}</button>
      </form>

      {ancha
        ? <p className="aviso aviso-mal" style={{ marginTop: 18 }}>{t(lang, 'searchTooBroad')}</p>
        : <ArtworkGrid lang={lang} items={results} />}
      <Paginacion
        lang={lang}
        page={pagina}
        hasNext={hayMas}
        basePath={path(lang, 'search')}
        params={sp}
        pageSize={POR_PAGINA}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label>{label}</label>{children}</div>;
}

const CATEGORIES: Record<string, Record<string, string>> = {
  painting:   { es: 'Pintura', en: 'Painting', fr: 'Peinture', it: 'Dipinto', de: 'Gemälde', pt: 'Pintura', nl: 'Schilderij' },
  sculpture:  { es: 'Escultura', en: 'Sculpture', fr: 'Sculpture', it: 'Scultura', de: 'Skulptur', pt: 'Escultura', nl: 'Beeldhouwwerk' },
  drawing:    { es: 'Dibujo', en: 'Drawing', fr: 'Dessin', it: 'Disegno', de: 'Zeichnung', pt: 'Desenho', nl: 'Tekening' },
  print:      { es: 'Grabado', en: 'Print', fr: 'Estampe', it: 'Stampa', de: 'Druckgrafik', pt: 'Gravura', nl: 'Prent' },
  photograph: { es: 'Fotografía', en: 'Photograph', fr: 'Photographie', it: 'Fotografia', de: 'Fotografie', pt: 'Fotografia', nl: 'Foto' },
};

function categoryLabel(lang: Lang, category: string): string {
  return CATEGORIES[category]?.[lang] ?? category;
}
