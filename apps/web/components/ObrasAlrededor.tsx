'use client';

/**
 * Las obras del radio: filtrarlas, ordenarlas y verlas en rejilla o en lista.
 *
 * Antes esto eran doce tarjetas por orden de distancia y nada más. Con 50 o
 * 200 km alrededor de una ciudad no salen doce obras: salen sesenta, y sin una
 * forma de recorrerlas la lista es un escaparate, no una herramienta. Quien
 * mira un radio quiere tres cosas —«¿está tal cuadro?», «¿qué hay de este
 * autor?», «enséñamelas de otra manera»— y las tres se resuelven aquí.
 *
 * **El texto se busca en el servidor; el orden y la vista, aquí.** No es una
 * simetría bonita, es dónde está la verdad de cada cosa: dentro de 5 km de
 * Barcelona hay más de mil obras y de aquí vienen 60, así que filtrar las 60
 * en memoria contestaría «ninguna coincide» sobre novecientas sin mirar. La
 * migración 0044 mete el texto en la propia consulta. Ordenar y cambiar de
 * vista, en cambio, solo tocan lo que ya está en pantalla: hacerlo con una
 * ida y vuelta al servidor sería más lento para el mismo resultado.
 *
 * Aun así hay un límite que decir en voz alta, y el recuento lo dice: vengan
 * de donde vengan, son **60 como mucho**, y son las 60 más destacadas del
 * radio —`artworks_near` ordena por notabilidad, no por distancia—.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { NearbyArtwork } from '@/lib/data';
import { formatDistance, formatNumber, t, type Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';

/**
 * El tope de `artworks_near` (`max_results`, en `lib/data.ts`).
 *
 * Está repetido a propósito y no se puede deducir de los datos: sesenta obras
 * pueden ser «las que hay» o «las que caben». Si allí cambia, aquí también.
 */
const TOPE = 60;

type Campo = 'distancia' | 'titulo' | 'artista' | 'museo' | 'anio';
type Dir = 'asc' | 'desc';

export default function ObrasAlrededor({ lang, works, filtro, onFiltro, buscando }: {
  lang: Lang;
  works: NearbyArtwork[];
  filtro: string;
  onFiltro: (v: string) => void;
  /** Hay una consulta en vuelo: lo que se ve es lo de antes, no lo de ahora. */
  buscando: boolean;
}) {
  const [lista, setLista] = useState(false);
  const [campo, setCampo] = useState<Campo>('distancia');
  const [dir, setDir] = useState<Dir>('asc');

  const visibles = useMemo(() => {
    /*
     * Los nulos van SIEMPRE al final, en los dos sentidos. Ordenar por autor y
     * que lo primero sean quince «—» es ordenar por lo que no se sabe: la
     * columna vacía no es un valor pequeño, es la ausencia de valor.
     */
    const cadena = (v: string | null) => v ?? '';
    const sinDato = (w: NearbyArtwork) => (
      campo === 'artista' ? w.artist_name === null
      : campo === 'museo' ? w.institution_name === null
      : campo === 'anio' ? w.year_start === null
      : false
    );

    const compara = (a: NearbyArtwork, b: NearbyArtwork): number => {
      switch (campo) {
        case 'distancia': return a.distance_m - b.distance_m;
        case 'anio': return (a.year_start ?? 0) - (b.year_start ?? 0);
        case 'titulo': return cadena(a.title).localeCompare(cadena(b.title), lang);
        case 'artista': return cadena(a.artist_name).localeCompare(cadena(b.artist_name), lang);
        case 'museo':
          return cadena(a.institution_name).localeCompare(cadena(b.institution_name), lang);
      }
    };

    return [...works].sort((a, b) => {
      const faltaA = sinDato(a);
      const faltaB = sinDato(b);
      if (faltaA !== faltaB) return faltaA ? 1 : -1;
      return dir === 'asc' ? compara(a, b) : -compara(a, b);
    });
  }, [works, campo, dir, lang]);

  /** Pulsar la columna que ya manda le da la vuelta; otra la cambia. */
  function ordenarPor(nuevo: Campo) {
    if (nuevo === campo) return setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    setCampo(nuevo);
    setDir('asc');
  }

  /*
   * En el tope no se dice «60 obras · las 60 más destacadas»: repetir el número
   * hace leer dos veces para entender que es el mismo. La frase del tope ya
   * lleva la cifra dentro, y además dice lo que la otra no —que hay más—.
   */
  const recuento = works.length >= TOPE
    ? t(lang, 'nearestOnly')
    : `${formatNumber(lang, works.length)} ${t(lang, 'artworks')}`;

  return (
    <>
      <div className="buscador-lista">
        <input
          type="search" value={filtro} onChange={(e) => onFiltro(e.target.value)}
          placeholder={t(lang, 'filterThese')} aria-label={t(lang, 'filterThese')}
        />

        <label className="small muted">
          {t(lang, 'sortBy')}{' '}
          <select
            value={campo}
            onChange={(e) => { setCampo(e.target.value as Campo); setDir('asc'); }}
          >
            <option value="distancia">{t(lang, 'byDistance')}</option>
            <option value="titulo">{t(lang, 'byTitle')}</option>
            <option value="artista">{t(lang, 'colArtist')}</option>
            <option value="museo">{t(lang, 'colMuseum')}</option>
            <option value="anio">{t(lang, 'date')}</option>
          </select>
        </label>

        <button className="btn" type="button" onClick={() => setLista((v) => !v)}>
          {lista ? t(lang, 'viewGrid') : t(lang, 'viewList')}
        </button>

        <span className="muted small" aria-live="polite">
          {buscando ? t(lang, 'loading') : recuento}
        </span>
      </div>

      <div className={buscando ? 'atenuado' : undefined}>
      {visibles.length === 0 ? (
        /* Sin filtro, el vacío es del radio; con filtro, de la búsqueda. Son
         * dos respuestas distintas y llevan a hacer dos cosas distintas:
         * ampliar el círculo, o escribir otra cosa. */
        <p className="muted">
          {filtro.trim() ? t(lang, 'noMatchHere') : t(lang, 'nothingInRadius')}
        </p>
      ) : lista ? (
        <div className="tabla-scroll">
          <table className="tabla">
            <thead>
              <tr>
                <Cabecera etiqueta={t(lang, 'artwork')} suyo="titulo" campo={campo} dir={dir} pulsar={ordenarPor} />
                <Cabecera etiqueta={t(lang, 'colArtist')} suyo="artista" campo={campo} dir={dir} pulsar={ordenarPor} />
                <Cabecera etiqueta={t(lang, 'colMuseum')} suyo="museo" campo={campo} dir={dir} pulsar={ordenarPor} />
                <Cabecera etiqueta={t(lang, 'date')} suyo="anio" campo={campo} dir={dir} pulsar={ordenarPor} />
                <Cabecera etiqueta={t(lang, 'byDistance')} suyo="distancia" campo={campo} dir={dir} pulsar={ordenarPor} />
              </tr>
            </thead>
            <tbody>
              {visibles.map((w) => (
                <tr key={w.id}>
                  <td><Link href={path(lang, 'artwork', w.id)}>{w.title}</Link></td>
                  <td className="muted">{w.artist_name ?? '—'}</td>
                  <td className="muted">
                    {w.institution_slug && w.institution_name
                      ? <Link href={path(lang, 'museum', w.institution_slug)}>{w.institution_name}</Link>
                      : w.institution_name ?? '—'}
                  </td>
                  <td className="muted">{w.date_display ?? w.year_start ?? '—'}</td>
                  <td className="num">{formatDistance(lang, w.distance_m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid">
          {visibles.map((w) => (
            <Link key={w.id} href={path(lang, 'artwork', w.id)} className="card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="card-image" src={w.image_url ?? ''} alt={w.title} loading="lazy" />
              <p className="card-title">{w.title}</p>
              <p className="card-meta">{w.artist_name}</p>
              <p className="card-meta small">
                {w.institution_name} · {formatDistance(lang, w.distance_m)} {t(lang, 'distance')}
              </p>
            </Link>
          ))}
        </div>
      )}
      </div>
    </>
  );
}

/** Una columna que ordena. Marca cuál manda y en qué sentido. */
function Cabecera({ etiqueta, suyo, campo, dir, pulsar }: {
  etiqueta: string; suyo: Campo; campo: Campo; dir: Dir; pulsar: (c: Campo) => void;
}) {
  const activo = campo === suyo;
  return (
    <th aria-sort={activo ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button" onClick={() => pulsar(suyo)}
        className={activo ? 'orden-activo' : undefined}
      >
        {etiqueta}{activo && (dir === 'asc' ? ' ▲' : ' ▼')}
      </button>
    </th>
  );
}
