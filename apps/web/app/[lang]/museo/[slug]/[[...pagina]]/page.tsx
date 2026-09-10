import { notFound } from 'next/navigation';
import { isLang, t, formatNumber, capitalize } from '@/lib/i18n';
import { supabase, artworksByInstitution } from '@/lib/data';
import { path } from '@/lib/routes';
import ArtworkGrid, { TarjetasObra } from '@/components/ArtworkGrid';
import WorldMap from '@/components/WorldMap';
import Paginacion, { paginaDeRuta } from '@/components/Paginacion';
import MasAlLlegarAbajo from '@/components/MasAlLlegarAbajo';

/*
 * Un día, no una hora.
 *
 * Con `revalidate = 3600` cada página que un rastreador vuelve a pisar pasada
 * la hora se regenera, y son 144 páginas: eso es render por página y hora,
 * pagado, para un catálogo que **solo cambia cuando se lanza una ingesta**. A
 * 24 horas las regeneraciones se dividen entre 24 y no se pierde nada, porque
 * entre ingesta e ingesta pasan días.
 *
 * **Cómo se purga cuando sí cambia:** desplegando. Cada despliegue estrena
 * caché, así que el `git push` que sigue a una ingesta ya deja el catálogo al
 * día. Si algún día la ingesta corre sin desplegar detrás —cuando se mude al
 * VPS—, hará falta que avise ella, con `revalidatePath` desde una ruta propia.
 *
 * La portada NO sube: enseña doce obras al azar y a un día se quedaría quieta.
 */
export const revalidate = 86_400;

/**
 * Vacío a propósito, y hace falta que exista.
 *
 * Sin `generateStaticParams` una ruta con segmento dinámico no es ISR: Next la
 * marca «server-rendered on demand» y la renderiza ENTERA en cada visita,
 * aunque tenga `revalidate`. Devolviendo la lista vacía no se prerenderiza nada
 * al construir —serían 144 páginas y un build de horas— pero la ruta pasa a
 * cachearse bajo demanda: la primera visita la genera y la guarda, y las
 * siguientes la reciben del CDN hasta que caduque la hora.
 *
 * Se comprueba en `.next/prerender-manifest.json`: la ruta tiene que aparecer
 * en `dynamicRoutes`. Si no está, no se está cacheando.
 */
export function generateStaticParams() {
  return [];
}

/*
 * 36 obras por página, no 60. En un móvil cada tarjeta ocupa una fila entera:
 * con 60 la ficha del Prado medía 35.000 píxeles de alto, unos 90 pantallazos
 * de scroll. Con 36 son 21.000, y cuando las tarjetas adelgacen bajará solo.
 */
const POR_PAGINA = 36;

/*
 * La página va en la RUTA —`/es/museo/museo-del-prado/p/2`— y no en `?p=2`.
 * Leer `searchParams` vuelve dinámica la página en el App Router, y eso
 * descartaba el `revalidate = 3600` de arriba: cada visita repetía el `select`
 * del museo, la RPC del mapa y el lote de obras. Por `params` llega gratis.
 * Las URLs viejas con `?p=` las redirige `next.config.ts`.
 */
interface Props {
  params: Promise<{ lang: string; slug: string; pagina?: string[] }>;
}

export default async function MuseumPage({ params }: Props) {
  const { lang, slug, pagina: segmentos } = await params;
  if (!isLang(lang)) notFound();

  const pagina = paginaDeRuta(segmentos);
  if (pagina === null) notFound();

  const { data: inst } = await supabase
    .from('institutions')
    .select(`id, slug, name, city, country, website, artwork_count, rating_avg, rating_count,
             institution_translations ( lang, name, city, country, description )`)
    .eq('slug', slug)
    .maybeSingle();

  if (!inst) notFound();

  const tr = (inst.institution_translations ?? []) as { lang: string; name: string; city: string | null; country: string | null; description: string | null }[];
  const text = tr.find((r) => r.lang === lang) ?? tr.find((r) => r.lang === 'en') ?? tr[0];

  /*
   * Con mayúscula inicial, como en el resto del sitio. Esta página se lee con
   * un `select` propio y no por `data.ts`, así que se quedó fuera de la regla
   * que ya arreglaba los títulos: la descripción del museo llegaba de Wikidata
   * en minúscula y se pintaba tal cual bajo el nombre.
   */
  const name = capitalize(text?.name ?? inst.name);
  const city = text?.city ? capitalize(text.city) : inst.city;
  const country = text?.country ? capitalize(text.country) : inst.country;

  // El punto sigue viniendo del mapa; las obras, ya no. Se piden por museo
  // (0023) para poder paginarlas y para que la lista cuadre con el contador.
  const { data: point } = await supabase
    .rpc('institutions_in_bbox', { west: -180, south: -85, east: 180, north: 85, p_lang: lang });

  const pin = (point ?? []).find((p: { id: number }) => p.id === inst.id);

  // Una obra más de las que caben: si vuelve, hay página siguiente. Es más
  // barato que contar, y es lo único que la paginación necesita saber.
  const lote = await artworksByInstitution(lang, slug, POR_PAGINA + 1, (pagina - 1) * POR_PAGINA);
  const works = lote.slice(0, POR_PAGINA);
  const hayMas = lote.length > POR_PAGINA;

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
        {text?.description && <p className="muted">{capitalize(text.description)}</p>}
        {inst.website && (
          <p className="small">
            <a href={inst.website} target="_blank" rel="noopener noreferrer">{inst.website} ↗</a>
          </p>
        )}
      </header>

      {pin && <WorldMap pins={[pin]} lang={lang} center={[pin.lng, pin.lat]} zoom={14} />}

      <section style={{ paddingTop: 28 }}>
        <h2>{t(lang, 'worksHere')}</h2>
        {/*
          * La lista sigue sola al llegar abajo, y todo cae en UNA sola rejilla:
          * las tarjetas del primer lote, las que trae el scroll y el aviso. Un
          * `.grid` por lote calcularía sus columnas aparte y dejaría un hueco
          * en mitad de la lista, justo donde el scroll pretende no notarse.
          *
          * La `Paginacion` no desaparece: va dentro, pintada en el servidor
          * —así su enlace a la página siguiente está en el HTML, para quien no
          * ejecuta JavaScript y para quien indexa— y solo se esconde cuando el
          * scroll ha demostrado que puede sustituirla.
          */}
        {hayMas ? (
          <div className="grid">
            <TarjetasObra lang={lang} items={works} />
            <MasAlLlegarAbajo
              lang={lang}
              slug={slug}
              desdePagina={pagina + 1}
              basePath={path(lang, 'museum', slug)}
            >
              <Paginacion
                lang={lang} page={pagina} hasNext
                basePath={path(lang, 'museum', slug)} modo="ruta"
                total={inst.artwork_count} pageSize={POR_PAGINA}
              />
            </MasAlLlegarAbajo>
          </div>
        ) : (
          /* Última página: no hay nada que traer, así que no se monta el
             observador. Queda el «Anterior» de siempre. */
          <>
            <ArtworkGrid lang={lang} items={works} />
            <Paginacion
              lang={lang} page={pagina} hasNext={false}
              basePath={path(lang, 'museum', slug)} modo="ruta"
              total={inst.artwork_count} pageSize={POR_PAGINA}
            />
          </>
        )}
      </section>
    </>
  );
}
