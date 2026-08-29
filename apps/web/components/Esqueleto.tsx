/**
 * Lo que se ve mientras la página se está trayendo sus datos.
 *
 * Antes de esto, pulsar un museo dejaba la pantalla anterior congelada hasta
 * que Supabase contestaba: sin barra de carga, sin nada. En una app cuyas
 * consultas rondan el segundo, eso se lee como «no ha funcionado el enlace», y
 * la reacción natural es volver a pulsar.
 *
 * La forma del esqueleto imita la de la página de verdad —misma rejilla, misma
 * proporción de tarjeta— y eso no es un capricho estético: si no coincide, al
 * llegar los datos todo salta de sitio, y un salto molesta más que la espera
 * que veníamos a disimular.
 */

/** Una mancha gris que respira. El ladrillo de todo lo demás. */
export function Bloque({ ancho, alto, radio = 6 }: {
  ancho?: string | number; alto?: string | number; radio?: number;
}) {
  return (
    <span
      className="esqueleto"
      style={{ width: ancho, height: alto ?? '1em', borderRadius: radio }}
      aria-hidden="true"
    />
  );
}

/** La rejilla de obras: la misma que pinta `ArtworkGrid` cuando hay datos. */
export function RejillaEsqueleto({ tarjetas = 12 }: { tarjetas?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: tarjetas }, (_, i) => (
        <div key={i} className="card">
          <span className="esqueleto card-image" style={{ display: 'block' }} />
          <Bloque ancho={`${60 + ((i * 37) % 35)}%`} alto={13} />
          <Bloque ancho={`${35 + ((i * 23) % 30)}%`} alto={11} />
        </div>
      ))}
    </div>
  );
}

/**
 * La ficha de una obra o de un artista.
 *
 * Los anchos de las líneas varían un poco entre sí a propósito: un bloque de
 * barras idénticas se lee como un gráfico, no como texto que está llegando.
 */
export function FichaEsqueleto() {
  return (
    <div className="detail" aria-hidden="true">
      <span className="esqueleto" style={{ display: 'block', aspectRatio: '4 / 3', borderRadius: 10 }} />
      <div>
        <Bloque ancho="72%" alto={30} />
        <div style={{ height: 10 }} />
        <Bloque ancho="45%" alto={15} />
        <div style={{ height: 26 }} />
        {[88, 74, 92, 61, 80].map((w, i) => (
          <div key={i} style={{ padding: '9px 0' }}><Bloque ancho={`${w}%`} alto={13} /></div>
        ))}
      </div>
    </div>
  );
}

/**
 * El hueco del mapa.
 *
 * Reutiliza la clase `.map`, que es la que fija su altura —`min(72vh, 640px)`—,
 * en vez de repetir la medida aquí. Si mañana el mapa cambia de alto, el hueco
 * cambia con él y no hay dos números que se desincronizan.
 *
 * Sin esto, el esqueleto del museo medía 800 px menos que la página real y la
 * rejilla daba un brinco al llegar los datos. Medido, no supuesto.
 */
export function MapaEsqueleto() {
  return <span className="esqueleto map" style={{ display: 'block' }} aria-hidden="true" />;
}

/** La fila de filtros del buscador. */
export function FiltrosEsqueleto() {
  return (
    <div className="filters" aria-hidden="true">
      {[130, 130, 130, 96].map((w, i) => (
        <div key={i}><Bloque ancho={w} alto={38} radio={10} /></div>
      ))}
    </div>
  );
}

/**
 * La cabecera de una sección: título y las líneas de contexto que haya.
 *
 * `lineas` existe porque no todas miden lo mismo: la de un museo lleva ciudad,
 * número de obras, descripción y enlace a su web —cuatro líneas—, y la del
 * buscador solo una. Con dos fijas, la rejilla del museo bajaba 111 px al
 * llegar los datos. También medido.
 */
export function CabeceraEsqueleto({ lineas = [22] }: { lineas?: number[] }) {
  return (
    <header style={{ padding: '30px 0 6px' }} aria-hidden="true">
      <Bloque ancho="40%" alto={30} />
      {lineas.map((ancho, i) => (
        <div key={i} style={{ paddingTop: i === 0 ? 8 : 6 }}>
          <Bloque ancho={`${ancho}%`} alto={14} />
        </div>
      ))}
    </header>
  );
}

/**
 * Y el aviso para quien no ve la pantalla.
 *
 * Todo lo de arriba está marcado `aria-hidden`: para un lector de pantalla, un
 * montón de manchas grises no es información, es ruido. Lo que sí necesita es
 * que alguien le diga que la página está cargando, y eso es esto.
 */
export function Cargando({ que = 'Cargando' }: { que?: string }) {
  return <p role="status" className="visually-hidden">{que}…</p>;
}
