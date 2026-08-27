import Link from 'next/link';
import type { Lang } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { imageUrl } from '@/lib/images';

export interface GridItem {
  id: number;
  title: string;
  image_url: string | null;
  date_display?: string | null;
  year_start?: number | null;
  artist_name?: string | null;
  institution_name?: string | null;
  subtitle?: string;
}

export default function ArtworkGrid({ items, lang }: { items: GridItem[]; lang: Lang }) {
  if (items.length === 0) {
    return <p className="empty">{t(lang, 'noResults')}</p>;
  }

  return (
    <div className="grid">
      {items.map((item) => (
        <Link key={item.id} href={`/${lang}/obra/${item.id}`} className="card">
          {/* <img> y no next/image a propósito: las imágenes de Commons vienen
              de decenas de hosts y con tamaños impredecibles, y el optimizador
              de Next tendría que descargarlas todas en el servidor. */}
          <img
            className="card-image"
            src={imageUrl(item.image_url, 500) ?? ''}
            alt={item.title}
            loading="lazy"
          />
          <p className="card-title">{item.title}</p>
          <p className="card-meta">
            {item.subtitle ?? [
              item.artist_name,
              item.date_display ?? item.year_start,
            ].filter(Boolean).join(' · ')}
          </p>
          {item.institution_name && (
            <p className="card-meta small">{item.institution_name}</p>
          )}
        </Link>
      ))}
    </div>
  );
}
