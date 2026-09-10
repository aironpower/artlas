import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLang, t, type Lang } from '@/lib/i18n';
import { getArtwork, artworksByArtist, artworksByInstitution } from '@/lib/data';
import { imageUrl } from '@/lib/images';
import { path } from '@/lib/routes';
import ArtworkGrid from '@/components/ArtworkGrid';
import ArtworkImage from '@/components/ArtworkImage';
import { BotonFavorito } from '@/components/BotonFavorito';
import { SoloAdmin } from '@/components/SoloAdmin';

/*
 * Un día, no una hora.
 *
 * Con `revalidate = 3600` cada página que un rastreador vuelve a pisar pasada
 * la hora se regenera, y son 405.000 páginas: eso es render por página y hora,
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
 * al construir —serían 405.000 páginas y un build de horas— pero la ruta pasa a
 * cachearse bajo demanda: la primera visita la genera y la guarda, y las
 * siguientes la reciben del CDN hasta que caduque la hora.
 *
 * Se comprueba en `.next/prerender-manifest.json`: la ruta tiene que aparecer
 * en `dynamicRoutes`. Si no está, no se está cacheando.
 */
export function generateStaticParams() {
  return [];
}

/** Cuántas obras se enseñan en cada sección de "sigue por aquí". */
const RELACIONADAS = 12;

interface Props { params: Promise<{ lang: string; id: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang, id } = await params;
  if (!isLang(lang)) return {};

  const work = await getArtwork(lang, Number(id));
  if (!work) return {};

  return {
    title: `${work.title}${work.artist ? ` — ${work.artist.name}` : ''} · Artlas`,
    description: work.description ?? undefined,
    openGraph: { images: imageUrl(work.imageUrl, 1280) ? [imageUrl(work.imageUrl, 1280)!] : [] },
  };
}

export default async function ArtworkPage({ params }: Props) {
  const { lang, id } = await params;
  if (!isLang(lang)) notFound();

  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  const work = await getArtwork(lang, numericId);
  if (!work) notFound();

  /*
   * **Aquí NO se pregunta quién mira, y ese es el punto.**
   *
   * Hasta el 9 de septiembre de 2026 esta página leía `currentUser()`,
   * `esFavorita()` y `viewerIsAdmin()` antes de pintar, con un comentario que
   * aseguraba que eso «no vuelve dinámica la página». Sí lo hacía: las tres
   * pasan por `cookies()`, y en el App Router sin PPR una sola lectura de
   * cookie en cualquier punto del árbol descarta el render estático de la ruta
   * entera. El `revalidate = 3600` de arriba no llegaba a aplicarse, y el
   * `prerender-manifest` del build lo enseñaba: `/[lang]/obra/[id]` no
   * aparecía ni como estática ni como ISR. 1,7 millones de renders al mes para
   * 691 escrituras de caché.
   *
   * Lo que depende de quién mira vive ahora en el navegador: `BotonFavorito` y
   * `SoloAdmin` preguntan por su cuenta, y solo si hay sesión. El HTML de esta
   * ficha es idéntico para todo el mundo, que es lo que permite guardarlo.
   */
  const ruta = path(lang, 'artwork', work.id);

  /*
   * Por dónde seguir. Antes solo había "más obras del mismo autor", y eso
   * dejaba sin salida al 15% del catálogo: 9.336 obras publicadas no tienen
   * autor —Guernica, sin ir más lejos— y la sección sencillamente no se
   * pintaba. La ficha terminaba en blanco y el visitante, en un callejón.
   *
   * El museo, en cambio, lo tienen TODAS: cero obras publicadas sin museo. Por
   * eso va también, y en ese orden: el autor es lo más afín cuando existe, y el
   * museo es la red que nunca falla.
   *
   * Se pide una obra de más porque una de las que vuelven es esta misma, y hay
   * que quitarla sin dejar la fila coja.
   */
  const [alsoBy, alsoHere] = await Promise.all([
    work.artist
      ? artworksByArtist(lang, work.artist.slug, RELACIONADAS + 1)
      : Promise.resolve([]),
    work.institution
      ? artworksByInstitution(lang, work.institution.slug, RELACIONADAS + 1)
      : Promise.resolve([]),
  ]);

  const delAutor = alsoBy.filter((w) => w.id !== work.id).slice(0, RELACIONADAS);
  const delMuseo = alsoHere.filter((w) => w.id !== work.id).slice(0, RELACIONADAS);

  return (
    <>
      <article className="detail">
        <div>
          <ArtworkImage
            className="detail-image"
            mode={work.imageMode}
            imageUrl={work.imageUrl}
            thumbnailUrl={work.thumbnailUrl}
            originUrl={work.originUrl ?? work.institution?.website ?? null}
            title={work.title}
            width={1280}
            lang={lang}
          />
          {work.imageMode === 'full' && work.imageLicense && (
            <p className="small muted" style={{ marginTop: 8 }}>{work.imageLicense}</p>
          )}
        </div>

        <div>
          <h1>{work.title}</h1>

          {/*
            * Guardar la obra y, si quien mira administra, corregirla sin dar
            * la vuelta por el panel: se ve el fallo en la ficha pública y se
            * arregla desde ahí, que es donde uno lo nota.
            */}
          <div className="acciones-ficha">
            <BotonFavorito lang={lang} obraId={work.id} ruta={ruta} />
            <SoloAdmin>
              <Link className="btn" href={`${path(lang, 'admin')}/corregir/obra/${work.id}`}>
                {t(lang, 'editThis')}
              </Link>
            </SoloAdmin>
          </div>

          {work.artist && (
            <p style={{ fontSize: '1.05rem', margin: '0 0 4px' }}>
              <Link href={path(lang, 'artist', work.artist.slug)}>
                {work.artist.name}
              </Link>
              {work.artist.birthYear && (
                <span className="muted small">
                  {' '}({work.artist.birthYear}–{work.artist.deathYear ?? '?'})
                </span>
              )}
            </p>
          )}

          {work.description && <p className="muted">{work.description}</p>}

          {work.movements.length > 0 && (
            <ul className="chips">
              {work.movements.map((m: { id: number; slug: string; name: string }) => (
                <li key={m.id}>
                  <Link href={`${path(lang, 'search')}?mov=${m.slug}`} className="chip">{m.name}</Link>
                </li>
              ))}
            </ul>
          )}

          <ul className="facts">
            {work.dateDisplay && <Fact k={t(lang, 'date')} v={work.dateDisplay} />}
            {work.medium && <Fact k={t(lang, 'technique')} v={work.medium} />}
            {work.genre && <Fact k={t(lang, 'genre')} v={work.genre} />}
            {work.heightCm && work.widthCm && (
              <Fact k={t(lang, 'dimensions')} v={`${work.heightCm} × ${work.widthCm} cm`} />
            )}
            {work.institution && (
              <li>
                <span className="k">{t(lang, 'inMuseum')}</span>
                <span>
                  <Link href={path(lang, 'museum', work.institution.slug)}>
                    {work.institution.name}
                  </Link>
                  <br />
                  <span className="muted small">
                    {[work.institution.city, work.institution.country].filter(Boolean).join(', ')}
                  </span>
                </span>
              </li>
            )}
          </ul>

          {work.sourceUrl && (
            <p className="small muted" style={{ marginTop: 18 }}>
              <a href={work.sourceUrl} target="_blank" rel="noopener noreferrer">Wikidata ↗</a>
            </p>
          )}
        </div>
      </article>

      {delAutor.length > 0 && work.artist && (
        <section>
          <div className="section-head">
            <h2>{t(lang, 'moreBy')} {work.artist.name}</h2>
            <Link className="small" href={path(lang, 'artist', work.artist.slug)}>
              {t(lang, 'seeAll')} →
            </Link>
          </div>
          <ArtworkGrid lang={lang as Lang} items={delAutor} />
        </section>
      )}

      {delMuseo.length > 0 && work.institution && (
        <section>
          <div className="section-head">
            <h2>{t(lang, 'moreAtMuseum')}</h2>
            <Link className="small" href={path(lang, 'museum', work.institution.slug)}>
              {t(lang, 'seeAll')} →
            </Link>
          </div>
          <ArtworkGrid lang={lang as Lang} items={delMuseo} />
        </section>
      )}
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <li><span className="k">{k}</span><span>{v}</span></li>;
}
