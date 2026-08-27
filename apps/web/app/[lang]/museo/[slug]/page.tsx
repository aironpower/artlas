import { notFound } from 'next/navigation';
import { isLang, t, formatNumber } from '@/lib/i18n';
import { supabase, artworksNear } from '@/lib/data';
import ArtworkGrid from '@/components/ArtworkGrid';
import WorldMap from '@/components/WorldMap';

export const revalidate = 3600;

interface Props { params: Promise<{ lang: string; slug: string }> }

export default async function MuseumPage({ params }: Props) {
  const { lang, slug } = await params;
  if (!isLang(lang)) notFound();

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

  // Las obras del museo se piden por su punto exacto con un radio mínimo:
  // reutiliza `artworks_near`, que ya resuelve el idioma con su cadena de
  // respaldo, en vez de duplicar esa lógica en una consulta nueva.
  const { data: point } = await supabase
    .rpc('institutions_in_bbox', { west: -180, south: -85, east: 180, north: 85, p_lang: lang });

  const pin = (point ?? []).find((p: { id: number }) => p.id === inst.id);
  const works = pin ? await artworksNear(lang, pin.lat, pin.lng, 50) : [];

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
      </section>
    </>
  );
}
