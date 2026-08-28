import { notFound } from 'next/navigation';
import { isLang, t, formatNumber } from '@/lib/i18n';
import { supabase, artworksByInstitution } from '@/lib/data';
import { path } from '@/lib/routes';
import ArtworkGrid from '@/components/ArtworkGrid';
import WorldMap from '@/components/WorldMap';
import Paginacion, { leerPagina } from '@/components/Paginacion';

export const revalidate = 3600;

/*
 * 36 obras por página, no 60. En un móvil cada tarjeta ocupa una fila entera:
 * con 60 la ficha del Prado medía 35.000 píxeles de alto, unos 90 pantallazos
 * de scroll. Con 36 son 21.000, y cuando las tarjetas adelgacen bajará solo.
 */
const POR_PAGINA = 36;

interface Props {
  params: Promise<{ lang: string; slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function MuseumPage({ params, searchParams }: Props) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();

  const pagina = leerPagina((await searchParams).p);

  const { data: inst } = await supabase
    .from('institutions')
    .select(`id, slug, name, city, country, website, artwork_count, rating_avg, rating_count,
             institution_translations ( lang, name, city, country, description )`)
    .eq('slug', slug)
    .maybeSingle();

  if (!inst) notFound();

  const tr = (inst.institution_translations ?? []) as { lang: string; name: string; city: string | null; country: string | null; description: string | null }[];
  const text = tr.find((r) => r.lang === lang) ?? tr.find((r) => r.lang === 'en') ?? tr[0];

  const name = text?.name ?? inst.name;
  const city = text?.city ?? inst.city;
  const country = text?.country ?? inst.country;

  // El punto sigue viniendo del mapa; las obras, ya no. Se piden por museo
  // (0023) para poder paginarlas y para que la lista cuadre con el contador.
  const { data: point } = await supabase
    .rpc('institutions_in_bbox', { west: -180, south: -85, east: 180, north: 85, p_lang: lang });

  const pin = (point ?? []).find((p: { id: number }) => p.id === inst.id);

  // Una obra más de las que caben: si vuelve, hay página siguiente. Es más
  // barato que contar, y es lo único que la paginación necesita saber.
  const lote = await artworksByInstitution(lang, slug, POR_PAGINA + 1, (pagina - 1) * POR_PAGINA);
  const works = lote.slice(0, POR_PAGINA);

  /*
   * Una página más allá del final no es una página vacía: no existe. Se mira
   * lo que ha vuelto y no el contador, que se recalcula al terminar cada
   * ingesta y puede ir un rato por detrás de las filas.
   */
  if (pagina > 1 && lote.length === 0) notFound();


  return (
    <>
      <header style={{ padding: '30px 0 6px' }}>
        <h1>{name}</h1>
        <p className="muted">
          {[city, country].filter(Boolean).join(', ')} ·{' '}
          {formatNumber(lang, inst.artwork_count)} {t(lang, 'artworks')}
          {inst.rating_count > 0 && ` · ★ ${inst.rating_avg}`}
        </p>
        {text?.description && <p className="muted">{text.description}</p>}
        {inst.website && (
          <p className="small">
            <a href={inst.website} target="_blank" rel="noopener noreferrer">{inst.website} ↗</a>
          </p>
        )}
      </header>

      {pin && <WorldMap pins={[pin]} lang={lang} center={[pin.lng, pin.lat]} zoom={14} />}

      <section style={{ paddingTop: 28 }}>
        <h2>{t(lang, 'worksHere')}</h2>
        <ArtworkGrid lang={lang} items={works} />
        <Paginacion
          lang={lang}
          page={pagina}
          hasNext={lote.length > POR_PAGINA}
          basePath={path(lang, 'museum', slug)}
          total={inst.artwork_count}
          pageSize={POR_PAGINA}
        />
      </section>
    </>
  );
}
