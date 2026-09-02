'use client';

/**
 * Obras alrededor de un punto, elegido de tres maneras.
 *
 * Sustituye al botón «cerca de mí», que solo sabía una: dónde estás. Servía
 * para el que ya está en la ciudad y no para el que la está pensando, que es
 * casi todo el mundo cuando mira un mapa de museos. Ahora el punto se elige
 * con la posición del navegador, buscando un sitio por su nombre, o pinchando
 * en el mapa.
 *
 * **Un solo mapa, y es el que ya estaba.** La portada tenía el mapamundi de
 * museos debajo del botón; en vez de añadir un segundo mapa para elegir el
 * punto —dos instancias de MapLibre en la misma pantalla, y la duda de a cuál
 * mirar— este componente gobierna aquel. Las chinchetas de museo siguen donde
 * estaban; encima se dibujan el punto y su círculo.
 *
 * El círculo NO es decoración: es el radio con el que se pregunta. Por eso,
 * cuando el radio lo elige una persona, el servidor no lo amplía aunque no
 * encuentre nada. Un círculo de 5 km con obras de dentro de 300 sería un dibujo
 * que miente, y «no hay nada en 5 km» es una respuesta perfectamente útil.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import WorldMap from './WorldMap';
import ObrasAlrededor from './ObrasAlrededor';
import type { MapPin, NearbyArtwork } from '@/lib/data';
import { t, type Lang } from '@/lib/i18n';

interface Punto { lng: number; lat: number }

/*
 * Los radios que se ofrecen, y el zoom con el que cada uno se ve entero.
 *
 * Van juntos a propósito: elegir 50 km y quedarse en el zoom de 1 km deja el
 * círculo fuera de la pantalla, y entonces el mapa deja de explicar lo que se
 * está preguntando.
 */
const RADIOS = [
  { m: 1_000, zoom: 13 },
  { m: 5_000, zoom: 11 },
  { m: 15_000, zoom: 9.5 },
  { m: 50_000, zoom: 8 },
  { m: 200_000, zoom: 6 },
] as const;

/*
 * Las obras NO viven dentro del estado, y ese fue un fallo que solo se vio
 * escribiendo en la caja: con `{ fase: 'listo', works }`, cada tecla pasaba
 * por `buscando`, la sección entera se desmontaba y volvía, y con ella se iban
 * el foco del cursor y el modo lista que se acabara de elegir. Buscar era
 * imposible: se escribía una letra y el teclado se cerraba.
 *
 * Separadas, la fase dice si hay algo en vuelo y las obras siguen en pantalla
 * mientras tanto. `null` es «todavía no se ha preguntado»; una lista vacía es
 * una respuesta.
 */
type Estado =
  | { fase: 'quieto' }
  | { fase: 'buscando' }
  | { fase: 'sinPermiso' }
  | { fase: 'listo' };

export default function CercaDeAqui({ lang, pins }: { lang: Lang; pins: MapPin[] }) {
  const [punto, setPunto] = useState<Punto | null>(null);
  const [radio, setRadio] = useState<number>(15_000);
  const [estado, setEstado] = useState<Estado>({ fase: 'quieto' });
  const [works, setWorks] = useState<NearbyArtwork[] | null>(null);
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState('');
  const [sinLugar, setSinLugar] = useState(false);
  const [volarA, setVolarA] = useState<{ lng: number; lat: number; zoom: number } | null>(null);

  const zoomDe = (m: number) => RADIOS.find((r) => r.m === m)?.zoom ?? 11;

  /*
   * Cada petición lleva su número. Cambiar el radio deprisa lanza varias, y
   * sin esto la que conteste la última pinta sus resultados aunque sea de un
   * radio que ya nadie ha pedido: la lista y el círculo dirían cosas
   * distintas. Solo se acepta la respuesta de la última que salió.
   */
  const turno = useRef(0);

  const pedirObras = useCallback(async (p: Punto, metros: number, q = '') => {
    const mio = ++turno.current;
    setEstado({ fase: 'buscando' });

    try {
      const res = await fetch(
        `/api/cerca?lat=${p.lat}&lng=${p.lng}&lang=${lang}&radio=${metros}`
        + (q ? `&q=${encodeURIComponent(q)}` : ''),
      );
      if (!res.ok) throw new Error('cerca');
      const datos = await res.json() as { works: NearbyArtwork[] };
      if (mio !== turno.current) return;
      setWorks(datos.works);
      setEstado({ fase: 'listo' });
    } catch {
      if (mio !== turno.current) return;
      setWorks([]);
      setEstado({ fase: 'listo' });
    }
  }, [lang]);

  /*
   * Un punto nuevo, un radio nuevo o un texto nuevo son una pregunta nueva, y
   * las tres se contestan igual: preguntando al servidor.
   *
   * El texto espera 350 ms desde la última tecla. Filtrarlo en el navegador
   * sería instantáneo y sería mentira: dentro de 5 km de Barcelona hay más de
   * mil obras y de aquí vienen 60, así que «ninguna coincide» se estaría
   * diciendo sobre novecientas sin mirar. Prefiero la espera y la verdad.
   */
  useEffect(() => {
    if (!punto) return;

    const q = filtro.trim();
    if (!q) {
      void pedirObras(punto, radio);
      return;
    }

    const t = setTimeout(() => { void pedirObras(punto, radio, q); }, 350);
    return () => clearTimeout(t);
  }, [punto, radio, filtro, pedirObras]);

  function elegir(p: Punto, zoom?: number) {
    setSinLugar(false);
    setPunto(p);
    setFiltro('');
    setWorks(null);
    setVolarA({ ...p, zoom: zoom ?? zoomDe(radio) });
  }

  function miPosicion() {
    if (!navigator.geolocation) return setEstado({ fase: 'sinPermiso' });
    setEstado({ fase: 'buscando' });

    navigator.geolocation.getCurrentPosition(
      (pos) => elegir({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setEstado({ fase: 'sinPermiso' }),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  async function buscarLugar(ev: React.FormEvent) {
    ev.preventDefault();
    const q = texto.trim();
    if (q.length < 3) return;

    setSinLugar(false);
    setEstado({ fase: 'buscando' });

    try {
      const res = await fetch(`/api/lugar?q=${encodeURIComponent(q)}&lang=${lang}`);
      const datos = await res.json() as { lugares: { nombre: string; lat: number; lng: number }[] };
      const primero = datos.lugares?.[0];

      if (!primero) {
        setSinLugar(true);
        setEstado({ fase: 'quieto' });
        return;
      }

      elegir({ lat: primero.lat, lng: primero.lng });
    } catch {
      setSinLugar(true);
      setEstado({ fase: 'quieto' });
    }
  }

  const alPinchar = useCallback((p: Punto) => {
    setSinLugar(false);
    setPunto(p);
    setFiltro('');
    setWorks(null);
    // Pinchando NO se vuela: ya estás mirando donde has pinchado, y moverte el
    // mapa bajo el dedo es lo más molesto que puede hacer un mapa.
  }, []);

  return (
    <section style={{ padding: '4px 0 8px' }}>
      <div className="cerca-controles">
        <button className="btn btn-primary" onClick={miPosicion} type="button">
          {t(lang, 'nearMe')}
        </button>

        <form onSubmit={buscarLugar} className="cerca-lugar">
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t(lang, 'placeSearch')}
            aria-label={t(lang, 'searchPlace')}
          />
          <button className="btn" type="submit">{t(lang, 'searchPlace')}</button>
        </form>

        <label className="cerca-radio">
          {t(lang, 'radius')}
          <select
            value={radio}
            onChange={(e) => {
              const m = Number(e.target.value);
              setRadio(m);
              // El círculo nuevo tiene que caber en pantalla, o deja de
              // explicar lo que se está preguntando.
              if (punto) setVolarA({ ...punto, zoom: zoomDe(m) });
            }}
          >
            {RADIOS.map((r) => (
              <option key={r.m} value={r.m}>{r.m / 1000} km</option>
            ))}
          </select>
        </label>

        {punto && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              setPunto(null);
              setFiltro('');
              setWorks(null);
              setEstado({ fase: 'quieto' });
            }}
          >
            {t(lang, 'clearPoint')}
          </button>
        )}
      </div>

      <p className="muted small" style={{ padding: '2px 0 10px' }}>
        {sinLugar ? t(lang, 'placeNotFound')
          : estado.fase === 'buscando' ? t(lang, 'locating')
          : estado.fase === 'sinPermiso' ? t(lang, 'locationDenied')
          : t(lang, 'orClickMap')}
      </p>

      <WorldMap
        pins={pins}
        lang={lang}
        punto={punto}
        radioM={radio}
        onElegir={alPinchar}
        volarA={volarA}
      />

      {punto && works !== null && (
        <section style={{ paddingTop: 22 }}>
          <h2>{t(lang, 'worksAround')}</h2>

          {/*
            * El panel se pinta SIEMPRE, también sin resultados. Antes «Nada en
            * ese radio» sustituía a la lista entera; con el filtro dentro, eso
            * se llevaría por delante la caja donde se ha escrito y dejaría a
            * quien busca sin manera de borrar lo que buscó.
            */}
          <ObrasAlrededor
            lang={lang} works={works}
            filtro={filtro} onFiltro={setFiltro}
            buscando={estado.fase === 'buscando'}
          />
        </section>
      )}
    </section>
  );
}
