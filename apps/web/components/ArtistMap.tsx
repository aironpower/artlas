'use client';

/**
 * Mapa de las obras de un artista.
 *
 * Distinto de `WorldMap` a propósito. Aquel agrupa por museo y dimensiona la
 * chincheta según la colección entera; este pinta la obra concreta del artista
 * en su posición exacta, con un círculo llano y sin clustering de ningún tipo.
 *
 * La consecuencia de usar la posición exacta hay que asumirla:
 * `artworks.location` es una copia del punto del museo, así que las 40 obras de
 * Goya en el Prado caen en el MISMO píxel a cualquier nivel de zoom. No se
 * separan acercándose, porque no son posiciones distintas: son la misma. Por
 * eso el círculo lleva dentro cuántas obras hay en ese punto y el globo las
 * lista todas con enlace, que es la única manera de que ninguna quede tapada e
 * inalcanzable.
 *
 * Lo que NO se hace: desplazar las obras unos metros para que se vean sueltas.
 * Colocaría cuadros en la acera de enfrente del museo y el mapa mentiría.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ArtistWork } from '@/lib/data';
import type { Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';

/** Cuántas obras se listan en el globo antes de resumir el resto en «+N». */
const MAX_IN_POPUP = 8;

interface Props {
  works: ArtistWork[];
  lang: Lang;
}

interface Point {
  lat: number;
  lng: number;
  works: ArtistWork[];
}

export default function ArtistMap({ works, lang }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const router = useRouter();

  const navigate = useRef(router.push);
  navigate.current = router.push;

  const points = groupByPoint(works);

  // El encuadre se calcula una vez, con los datos del primer render. Guardarlo
  // en una ref evita que un re-render vuelva a mover el mapa cuando el usuario
  // ya lo había encuadrado a mano.
  const initialView = useRef(frame(points));

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      attributionControl: { compact: true },
      ...initialView.current,
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
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Los círculos, en un efecto aparte: cambian al cambiar de idioma y el mapa
  // no debe reconstruirse por eso.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    // De más obras a menos: el último añadido queda encima, así que en un
    // encuadre alejado el punto pequeño no tapa al grande.
    const ordered = [...groupByPoint(works)].sort((a, b) => b.works.length - a.works.length);

    const markers = ordered.map((point) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'dot';

      if (point.works.length > 1) {
        el.classList.add('dot-many');
        el.textContent = String(point.works.length);
      }

      el.setAttribute(
        'aria-label',
        `${point.works.length} · ${point.works[0].institution_name ?? ''}`,
      );

      const popup = new maplibregl.Popup({
        offset: point.works.length > 1 ? 16 : 10,
        closeButton: false,
        maxWidth: '280px',
      }).setHTML(popupHtml(point, lang));

      return new maplibregl.Marker({ element: el })
        .setLngLat([point.lng, point.lat])
        .setPopup(popup)
        .addTo(instance);
    });

    return () => markers.forEach((m) => m.remove());
  }, [works, lang]);

  /**
   * Los enlaces del globo son HTML plano —`setHTML` no admite componentes—, así
   * que se interceptan aquí para navegar con el router en vez de recargar la
   * página entera. Sin esto seguirían funcionando, solo que más lentos.
   */
  useEffect(() => {
    const node = container.current;
    if (!node) return;

    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const link = target?.closest?.('a[data-artwork]');
      if (!link) return;

      event.preventDefault();
      navigate.current(link.getAttribute('href') ?? '/');
    }

    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, []);

  return <div ref={container} className="map" />;
}

/**
 * Agrupa las obras que caen en el mismo punto.
 *
 * Sin esto habría un marcador por obra, pero los de un mismo museo quedarían
 * apilados: se vería un único círculo y solo el de encima respondería al ratón,
 * dejando las otras 39 obras invisibles e inalcanzables desde el mapa.
 */
function groupByPoint(works: ArtistWork[]): Point[] {
  const byPoint = new Map<string, Point>();

  for (const work of works) {
    if (work.lat === null || work.lng === null) continue;   // obra sin museo

    const key = `${work.lat},${work.lng}`;
    const existing = byPoint.get(key);

    if (existing) existing.works.push(work);
    else byPoint.set(key, { lat: work.lat, lng: work.lng, works: [work] });
  }

  return [...byPoint.values()];
}

/**
 * Encuadre inicial: que quepan todos los puntos.
 *
 * Un pintor con obra en Madrid y Nueva York necesita zoom mundial; uno con todo
 * en Florencia, no. Con un solo punto no hay caja que ajustar y se usa un zoom
 * de calle.
 */
function frame(points: Point[]) {
  if (points.length === 0) {
    return { center: [6, 46] as [number, number], zoom: 3.4 };
  }

  if (points.length === 1) {
    return { center: [points[0].lng, points[0].lat] as [number, number], zoom: 13 };
  }

  const bounds = new maplibregl.LngLatBounds();
  for (const point of points) bounds.extend([point.lng, point.lat]);

  return { bounds, fitBoundsOptions: { padding: 64, maxZoom: 12 } };
}

function popupHtml(point: Point, lang: Lang): string {
  const first = point.works[0];
  const place = [first.city, first.country].filter(Boolean).join(', ');

  const items = point.works.slice(0, MAX_IN_POPUP).map((work) => {
    const date = work.date_display ?? work.year_start ?? '';

    return (
      `<li><a data-artwork href="${path(lang, 'artwork', work.id)}">${escapeHtml(work.title)}</a>` +
      (date ? ` <span class="muted small">${escapeHtml(String(date))}</span>` : '') +
      '</li>'
    );
  }).join('');

  const rest = point.works.length - MAX_IN_POPUP;

  return (
    `<strong>${escapeHtml(first.institution_name ?? '')}</strong>` +
    (place ? `<br><span class="muted small">${escapeHtml(place)}</span>` : '') +
    `<ul class="popup-works">${items}</ul>` +
    (rest > 0 && first.institution_slug
      ? `<a data-artwork class="small" href="${path(lang, 'museum', first.institution_slug)}">+${rest}</a>`
      : '')
  );
}

/** Títulos y nombres de museo vienen de Wikidata: texto de terceros en innerHTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
