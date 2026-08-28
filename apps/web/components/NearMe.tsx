'use client';

/**
 * "Obras cerca de mí".
 *
 * La geolocalización se pide SOLO al pulsar el botón, nunca al cargar: un
 * permiso solicitado sin que el usuario haya hecho nada se deniega casi
 * siempre, y una vez denegado el navegador no vuelve a preguntar.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { NearbyArtwork } from '@/lib/data';
import { formatDistance, t, type Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';

type State =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'denied' }
  | { status: 'ready'; works: NearbyArtwork[] };

export default function NearMe({ lang }: { lang: Lang }) {
  const [state, setState] = useState<State>({ status: 'idle' });

  function locate() {
    if (!navigator.geolocation) return setState({ status: 'denied' });
    setState({ status: 'locating' });

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          // El radio (15 km, el útil de una ciudad) lo fija el servidor.
          const res = await fetch(
            `/api/cerca?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}&lang=${lang}`,
          );
          if (!res.ok) throw new Error('cerca');
          setState({ status: 'ready', works: (await res.json()) as NearbyArtwork[] });
        } catch {
          setState({ status: 'denied' });
        }
      },
      () => setState({ status: 'denied' }),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return (
    <section style={{ padding: '4px 0 20px' }}>
      {state.status === 'idle' && (
        <button className="btn btn-primary" onClick={locate}>📍 {t(lang, 'nearMe')}</button>
      )}

      {state.status === 'locating' && <p className="muted">{t(lang, 'locating')}</p>}
      {state.status === 'denied' && <p className="muted small">{t(lang, 'locationDenied')}</p>}

      {state.status === 'ready' && (
        state.works.length === 0
          ? <p className="muted">{t(lang, 'noResults')}</p>
          : (
            <>
              <h2>{t(lang, 'nearMe')}</h2>
              <div className="grid">
                {state.works.slice(0, 8).map((w) => (
                  <Link key={w.id} href={path(lang, 'artwork', w.id)} className="card">
                    <img className="card-image" src={w.image_url ?? ''} alt={w.title} loading="lazy" />
                    <p className="card-title">{w.title}</p>
                    <p className="card-meta">{w.artist_name}</p>
                    <p className="card-meta small">
                      {w.institution_name} · {formatDistance(lang, w.distance_m)} {t(lang, 'distance')}
                    </p>
                  </Link>
                ))}
              </div>
            </>
          )
      )}
    </section>
  );
}
