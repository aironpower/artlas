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

const FUENTE_RADIO = 'radio-elegido';

/**
 * El círculo del radio, como polígono.
 *
 * MapLibre sabe dibujar círculos, pero su radio se mide en PÍXELES: al alejar
 * el zoom el círculo seguiría igual de grande en pantalla y dejaría de
 * significar «5 km». Un polígono en coordenadas sí es de 5 km y se comporta
 * como debe al acercar y alejar.
 *
 * 96 lados: a simple vista es una circunferencia y sigue siendo un GeoJSON
 * pequeño. Los grados de longitud se dividen por el coseno de la latitud
 * porque un grado de longitud mide menos cuanto más al norte: sin eso, el
 * círculo de Estocolmo saldría un óvalo tumbado.
 */
function circuloGeoJSON(lng: number, lat: number, radioM: number): GeoJSON.Feature {
  const LADOS = 96;
  const GRADO_LAT_M = 111_320;
  const anillo: [number, number][] = [];

  for (let i = 0; i <= LADOS; i++) {
    const angulo = (i / LADOS) * 2 * Math.PI;
    const dLat = (radioM * Math.cos(angulo)) / GRADO_LAT_M;
    const dLng = (radioM * Math.sin(angulo))
      / (GRADO_LAT_M * Math.cos((lat * Math.PI) / 180));
    anillo.push([lng + dLng, lat + dLat]);
  }

  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [anillo] } };
}

const circuloVacio = (): GeoJSON.FeatureCollection =>
  ({ type: 'FeatureCollection', features: [] });

interface Props {
  pins: MapPin[];
  lang: Lang;
  /** Centro y zoom iniciales. Por defecto, Europa occidental. */
  center?: [number, number];
  zoom?: number;
  /** El punto elegido, si hay: marcador y círculo del radio. */
  punto?: { lng: number; lat: number } | null;
  /** Radio en metros del círculo. Solo se dibuja si hay punto. */
  radioM?: number;
  /** Si se pasa, pinchar en el mapa elige un punto. */
  onElegir?: (lngLat: { lng: number; lat: number }) => void;
  /** A dónde volar cuando cambia. Un objeto nuevo = un vuelo nuevo. */
  volarA?: { lng: number; lat: number; zoom: number } | null;
}

export default function WorldMap({
  pins, lang, center = [6, 46], zoom = 3.4,
  punto = null, radioM = 0, onElegir, volarA = null,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const router = useRouter();

  // El router cambia de identidad entre renders; guardarlo en una ref evita
  // recrear el mapa entero cada vez que Next revalida la página.
  const navigate = useRef(router.push);
  navigate.current = router.push;

  // Igual que `navigate`: cambia de identidad en cada render del padre y no
  // debe reconstruir el mapa por eso.
  const elegir = useRef(onElegir);
  elegir.current = onElegir;

  /*
   * El centro y el zoom son INICIALES, y por eso se congelan en una ref.
   *
   * Estaban en las dependencias del efecto que crea el mapa, y `center = [6, 46]`
   * es un array nuevo en cada render: el efecto se volvía a ejecutar siempre,
   * y su limpieza destruía el mapa para construir otro. Con la portada quieta
   * no se notaba —había un render y ya—, pero en cuanto algo de fuera tuvo
   * estado, cada pulsación tiraba el mapa y con él sus marcadores. Así se
   * descubrió: el punto elegido no aparecía nunca.
   *
   * Moverse después no es cosa de esto: para eso está `volarA`.
   */
  const inicial = useRef({ center, zoom });

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      center: inicial.current.center,
      zoom: inicial.current.zoom,
      attributionControl: { compact: true },
      /*
       * El estilo entero viene de OpenFreeMap, no se arma aqui.
       *
       * Positron: costas, agua y poco mas, con las etiquetas apareciendo solo
       * al acercarse. El mapa no es el contenido -es el papel sobre el que se
       * posan las obras- y las teselas normales de OSM, dibujadas para
       * orientarse andando, competian con las chinchetas.
       *
       * Por que OpenFreeMap y no CARTO, que es el Positron original: CARTO ya
       * exige clave de API y devuelve las teselas estampadas con "API KEY
       * REQUIRED". Se probo y se vio: respondian 200, asi que ninguna
       * comprobacion de red lo habria cazado; hizo falta mirar la imagen.
       *
       * Es un servicio de terceros sin contrato. Si un dia no responde, el
       * mapa se queda gris y las chinchetas siguen ahi, porque son marcadores
       * del DOM y no una capa del estilo.
       */
      style: 'https://tiles.openfreemap.org/styles/positron',
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    /*
     * La fuente del círculo se crea vacía al arrancar y luego solo se le
     * cambian los datos. Crearla y destruirla en cada cambio de radio hacía
     * parpadear la capa, y además `addSource` falla si el estilo aún no ha
     * cargado, que es la mitad de las veces.
     */
    instance.on('load', () => {
      if (instance.getSource(FUENTE_RADIO)) return;
      instance.addSource(FUENTE_RADIO, { type: 'geojson', data: circuloVacio() });
      instance.addLayer({
        id: 'radio-relleno', type: 'fill', source: FUENTE_RADIO,
        paint: { 'fill-color': '#c4462c', 'fill-opacity': 0.10 },
      });
      instance.addLayer({
        id: 'radio-borde', type: 'line', source: FUENTE_RADIO,
        paint: { 'line-color': '#c4462c', 'line-width': 1.5, 'line-opacity': 0.55 },
      });
    });

    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
    };
    // Una sola vez. Ver `inicial`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pinchar para elegir un punto. Solo si el padre quiere: en la ficha de un
  // museo el mapa es una ilustración y un clic ahí no significa nada.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !onElegir) return;

    const alPinchar = (e: maplibregl.MapMouseEvent) => {
      // Un clic en una chincheta ya tiene dueño: abre el museo. Los marcadores
      // están fuera del lienzo, así que el mapa ni se entera, pero el popup sí
      // vive dentro y hay que dejarlo pasar.
      const destino = e.originalEvent.target as HTMLElement | null;
      if (destino?.closest('.maplibregl-popup')) return;
      elegir.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    };

    instance.on('click', alPinchar);
    instance.getCanvas().style.cursor = 'crosshair';

    return () => { instance.off('click', alPinchar); };
  }, [onElegir]);

  // El marcador del punto elegido y su círculo.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const pintarCirculo = () => {
      const fuente = instance.getSource(FUENTE_RADIO) as maplibregl.GeoJSONSource | undefined;
      if (!fuente) return;
      fuente.setData(
        punto && radioM > 0
          ? { type: 'FeatureCollection', features: [circuloGeoJSON(punto.lng, punto.lat, radioM)] }
          : circuloVacio(),
      );
    };

    // El estilo puede no haber cargado todavía la primera vez.
    if (instance.isStyleLoaded()) pintarCirculo();
    else instance.once('load', pintarCirculo);

    if (!punto) return;

    const el = document.createElement('div');
    el.className = 'punto-elegido';
    el.setAttribute('aria-label', t(lang, 'chosenPoint'));
    const marcador = new maplibregl.Marker({ element: el })
      .setLngLat([punto.lng, punto.lat])
      .addTo(instance);

    return () => { marcador.remove(); };
  }, [punto, radioM, lang]);

  // Volar al sitio buscado. Un objeto nuevo es una orden nueva, aunque las
  // coordenadas se repitan: buscar dos veces lo mismo tiene que volver a ir.
  useEffect(() => {
    if (!map.current || !volarA) return;
    map.current.flyTo({ center: [volarA.lng, volarA.lat], zoom: volarA.zoom, duration: 1200 });
  }, [volarA]);

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
      /*
       * Un enlace de verdad, no un botón con manejador.
       *
       * Era un `<button>` que llamaba al router, y eso significaba que la
       * chincheta no se podía abrir en una pestaña nueva, no se podía copiar su
       * dirección y no la seguía ningún buscador: las 48 fichas de museo no
       * existían para nadie que no pulsara encima. Siendo `<a>` con `href`,
       * el navegador hace lo suyo y el clic normal lo seguimos interceptando
       * para que la navegación siga siendo instantánea.
       */
      const destino = path(lang, 'museum', pin.slug);
      const el = document.createElement('a');
      el.className = 'pin';
      el.href = destino;

      // El tamaño crece con la colección, pero por raíz cuadrada: si fuera
      // lineal, el Louvre taparía media Francia.
      /*
       * Todas del mismo tamaño.
       *
       * Antes el lado crecía con la raíz del número de obras, para que se
       * viera de un vistazo dónde hay más. Con el catálogo pasado de 260.000
       * eso dejó de funcionar: casi todas las grandes chocaban contra el tope
       * de 46 px y se leían igual, así que el tamaño costaba espacio sin
       * informar. La cifra dentro ya dice cuánto, y con todas iguales el mapa
       * queda más limpio y se solapan menos.
       */
      const size = 36;
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

      el.addEventListener('click', (ev) => {
        // Con Ctrl, Cmd, Mayúsculas o botón central, apartarse: quien pide una
        // pestaña nueva quiere una pestaña nueva, no que le roben el clic.
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        ev.preventDefault();
        navigate.current(destino);
      });

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
