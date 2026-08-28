import { notFound } from 'next/navigation';
import { isLang, t, formatNumber, type Lang } from '@/lib/i18n';
import { searchArtworks, listMovements, listCountries } from '@/lib/data';
import ArtworkGrid from '@/components/ArtworkGrid';

export const revalidate = 3600;

interface Params { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> }

/*
 * Tope de resultados. Se declara aquí y no se deja al valor por defecto de
 * `searchArtworks` porque la cabecera necesita saberlo: si vienen justo LIMIT
 * resultados, el total real es ese o más, y anunciar "60 obras" a secas era
 * decir que el catálogo tiene 60 cuadros de Rembrandt cuando tiene 119.
 */
const LIMIT = 60;

export default async function SearchPage({ params, searchParams }: Params) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();

  const sp = await searchParams;
  const filters = {
    query: sp.q,
    movement: sp.mov,
    artist: sp.artista,
    country: sp.pais,
    category: sp.cat,
    yearFrom: sp.desde ? Number(sp.desde) : undefined,
    yearTo: sp.hasta ? Number(sp.hasta) : undefined,
    limit: LIMIT,
  };

  const [results, movements, countries] = await Promise.all([
    searchArtworks(lang, filters),
    listMovements(lang),
    listCountries(lang),
  ]);

  return (
    <>
      <h1 style={{ paddingTop: 26 }}>
        {sp.q ? `“${sp.q}”` : t(lang, 'explore')}
        <span className="muted" style={{ fontSize: '1rem', fontWeight: 400, marginLeft: 10 }}>
          {formatNumber(lang, results.length)}{results.length === LIMIT && '+'}{' '}
          {t(lang, 'artworks')}
        </span>
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
          <select name="pais" defaultValue={sp.pais ?? ''}>
            <option value="">—</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name} ({c.count})</option>
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

      <ArtworkGrid lang={lang} items={results} />
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
