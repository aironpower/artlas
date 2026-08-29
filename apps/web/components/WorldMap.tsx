'use client';

/**
 * Mapa mundial de museos.
 *
 * Usa MapLibre con teselas raster de OpenStreetMap: sin clave de API y sin
 * coste. Un estilo vectorial daría mejor tipografía pero todos los proveedores
 * decentes piden registro, y para un mapa de chinchetas no compensa.
 *
 * Cada chincheta es un museo, con el número de obras dentro. Se agrupa por
 * museo y no por obra a propósito: 5.000 marcadores sueltos en el Louvre y el
 * Prado serían ilegibles y tumbarían el navegador.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapPin } from '@/lib/data';
import type { Lang } from '@/lib/i18n';
import { formatNumber, t } from '@/lib/i18n';
import { path } from '@/lib/routes';

interface Props {
  pins: MapPin[];
  lang: Lang;
  /** Centro y zoom iniciales. Por defecto, Europa occidental. */
  center?: [number, number];
  zoom?: number;
}

export default function WorldMap({ pins, lang, center = [6, 46], zoom = 3.4 }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const router = useRouter();

  // El router cambia de identidad entre renders; guardarlo en una ref evita
  // recrear el mapa entero cada vez que Next revalida la página.
  const navigate = useRef(router.push);
  navigate.current = router.push;

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      center,
      zoom,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap',
          },
        },
        layers: [{
          id: 'osm',
          type: 'raster',
          source: 'osm',
          /*
           * El mapa, en gris.
           *
           * Se desatura en la capa, con las propiedades de MapLibre, y no con
           * un `filter: grayscale()` de CSS: el filtro de CSS se aplica al
           * lienzo entero y se llevaría por delante también los chinchetas y
           * los globos, que son justamente lo que tiene que destacar.
           *
           * Y se sube el brillo mínimo además de quitar el tono: un mapa de
           * OSM desaturado a secas queda de un gris medio sucio que compite
           * con las obras. Aclarado, pasa a ser el papel sobre el que están.
           */
          paint: {
            'raster-saturation': -1,
            'raster-contrast': -0.15,
            'raster-brightness-min': 0.22,
          },
        }],
      },
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
    };
  }, [center, zoom]);

  // Chinchetas en un efecto aparte: los datos cambian al cambiar de idioma,
  // pero el mapa no debe reconstruirse por eso.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    // De menor a mayor colección: el último añadido queda ENCIMA, así que los
    // museos grandes tapan a los pequeños y no al revés. En París el Louvre
    // (943 obras) y Orsay (405) casi se solapan al alejar el zoom, y ver el
    // grande es más útil. Al acercarse se separan solos.
    const ordered = [...pins].sort((a, b) => a.artwork_count - b.artwork_count);

    const markers = ordered.map((pin) => {
      const el = document.createElement('button');
      el.className = 'pin';
      el.type = 'button';

      // El tamaño crece con la colección, pero por raíz cuadrada: si fuera
      // lineal, el Louvre taparía media Francia.
      const size = Math.min(46, 22 + Math.sqrt(pin.artwork_count) * 1.6);
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      /*
       * En corto: «14 k», no «999+».
       *
       * El tope de 999 se puso cuando el museo más grande tenía cuatro cifras.
       * Con 200.000 obras en el catálogo, casi todas las chinchetas grandes
       * decían lo mismo y el número dejaba de informar: un museo de 1.000
       * obras y otro de 21.000 se leían igual. El tamaño del círculo ya dice
       * «grande»; el número tiene que decir CUÁNTO.
       */
      el.textContent = pin.artwork_count < 1000
        ? String(pin.artwork_count)
        : `${(pin.artwork_count / 1000).toLocaleString(lang, {
            maximumFractionDigits: pin.artwork_count < 10_000 ? 1 : 0,
          })} k`;
      el.setAttribute(
        'aria-label',
        `${pin.name}, ${formatNumber(lang, pin.artwork_count)} ${t(lang, 'artworks')}`,
      );

      const popup = new maplibregl.Popup({ offset: size / 2 + 6, closeButton: false })
        .setHTML(
          `<strong>${escapeHtml(pin.name)}</strong><br>` +
          `<span style="color:var(--muted);font-size:.87rem">` +
          `${escapeHtml([pin.city, pin.country].filter(Boolean).join(', '))}<br>` +
          `${formatNumber(lang, pin.artwork_count)} ${t(lang, 'artworks')}</span>`,
        );

      el.addEventListener('click', () => navigate.current(path(lang, 'museum', pin.slug)));

      return new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .setPopup(popup)
        .addTo(instance);
    });

    return () => markers.forEach((m) => m.remove());
  }, [pins, lang]);

  return <div ref={container} className="map" />;
}

/** Los nombres de museo vienen de Wikidata: texto de terceros en innerHTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
