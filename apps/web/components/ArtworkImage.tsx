/**
 * La imagen de una obra, según lo que se pueda enseñar de ella.
 *
 * Un solo sitio en toda la app donde se decide cómo se pinta una obra, y ni
 * siquiera decide: obedece a `image_mode`, que viene calculado de SQL. Repartir
 * ese criterio por los componentes sería tener tantas políticas de derechos
 * como sitios pintan una imagen.
 *
 *   full       la reproducción, como siempre
 *   thumbnail  solo la miniatura del proveedor, a su tamaño y sin ampliar,
 *              con enlace obligado a la web de origen — el modelo de Europeana
 *   none       ni eso: un hueco explicado y el enlace al museo
 *
 * Lo que NUNCA hace en modo `thumbnail`: estirar la miniatura para que llene
 * el hueco. Ampliar una imagen que solo se puede mostrar pequeña es saltarse
 * la condición por la que se puede mostrar.
 */

import type { ImageMode } from '@/lib/data';
import type { Lang } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { imageUrl, type ThumbWidth } from '@/lib/images';

interface Props {
  mode: ImageMode;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  originUrl: string | null;
  title: string;
  /** Ancho para el modo `full`. La miniatura va siempre a su tamaño. */
  width?: ThumbWidth;
  className?: string;
  lang: Lang;
  /** En las tarjetas de la rejilla no cabe el texto explicativo. */
  compact?: boolean;
}

export default function ArtworkImage({
  mode, imageUrl: raw, thumbnailUrl, originUrl, title, width = 500,
  className, lang, compact = false,
}: Props) {
  if (mode === 'full') {
    return (
      <img className={className} src={imageUrl(raw, width) ?? ''} alt={title} loading="lazy" />
    );
  }

  if (mode === 'thumbnail' && thumbnailUrl) {
    return (
      <figure className={`thumb-only ${className ?? ''}`}>
        <img src={thumbnailUrl} alt={title} loading="lazy" />
        {!compact && (
          <figcaption className="small muted">
            {t(lang, 'rightsNotice')}
            {originUrl && (
              <>
                {' '}
                <a href={originUrl} target="_blank" rel="noopener noreferrer">
                  {t(lang, 'viewAtMuseum')} ↗
                </a>
              </>
            )}
          </figcaption>
        )}
      </figure>
    );
  }

  return (
    <div className={`no-image ${className ?? ''}`}>
      <span className="small muted">{t(lang, 'imageRestricted')}</span>
      {!compact && originUrl && (
        <a href={originUrl} target="_blank" rel="noopener noreferrer" className="small">
          {t(lang, 'viewAtMuseum')} ↗
        </a>
      )}
    </div>
  );
}
