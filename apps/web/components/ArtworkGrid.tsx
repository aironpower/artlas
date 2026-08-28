import Link from 'next/link';
import type { Lang } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { path } from '@/lib/routes';
import ArtworkImage from './ArtworkImage';
import type { ImageMode } from '@/lib/data';

export interface GridItem {
  id: number;
  title: string;
  image_url: string | null;
  /* Los derechos vienen de las RPC. Son opcionales porque alguna pantalla
   * antigua podría no pedirlos; sin ellos se asume la imagen tal cual. */
  image_mode?: ImageMode;
  thumbnail_url?: string | null;
  origin_url?: string | null;
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
        <Link key={item.id} href={path(lang, 'artwork', item.id)} className="card">
          {/* <img> y no next/image a propósito: las imágenes de Commons vienen
              de decenas de hosts y con tamaños impredecibles, y el optimizador
              de Next tendría que descargarlas todas en el servidor. */}
          <ArtworkImage
            className="card-image"
            mode={item.image_mode ?? 'full'}
            imageUrl={item.image_url}
            thumbnailUrl={item.thumbnail_url ?? null}
            originUrl={item.origin_url ?? null}
            title={item.title}
            lang={lang}
            compact
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
