'use client';

/**
 * Elegir el museo que se va a ingerir: por su nombre, o pegando su QID.
 *
 * Antes esto era un `<input>` que solo aceptaba un QID. Funcionaba para quien
 * sabe qué es Wikidata y no para nadie más, y era el último paso del panel que
 * seguía pidiendo saber cómo funciona esto por dentro — es decir, lo que
 * impedía delegar «añade este museo» en otra persona.
 *
 * **Sigue siendo el mismo campo `museum`.** No hay campo oculto ni segundo
 * formulario: la caja donde se escribe el nombre es la que se envía, y al
 * elegir un candidato su valor pasa a ser el QID. Así el `required` y el
 * `pattern` del navegador siguen valiendo de red —un nombre a medio resolver no
 * se puede encargar— sin inventar un estado nuevo que mantener en pie.
 *
 * Y se dice lo que se sabe ANTES de encargar: cómo se llama de verdad ese QID,
 * y si ya lo tenemos. Encargar un museo que ya está y encargar uno nuevo son
 * dos cosas distintas —una actualiza, la otra ocupa espacio del que quedan
 * ~98 MB— y hasta ahora se veían igual: una caja con una Q y unos números.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatNumber, type Lang } from '@/lib/i18n';
import { path } from '@/lib/routes';

interface Candidato {
  qid: string;
  nombre: string;
  descripcion: string | null;
  catalogo: { id: number; obras: number; ciudad: string | null } | null;
  situado: boolean;
}

const ES_QID = /^Q[1-9][0-9]*$/;

type Fase = 'quieto' | 'buscando' | 'nada' | 'error';

export default function BuscarMuseo({ lang }: { lang: Lang }) {
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState<Candidato[]>([]);
  const [elegido, setElegido] = useState<Candidato | null>(null);
  const [fase, setFase] = useState<Fase>('quieto');
  const [buscado, setBuscado] = useState('');
  const [verOtros, setVerOtros] = useState(false);

  /*
   * Cada búsqueda lleva su número. Escribir deprisa lanza varias y, sin esto,
   * la que conteste la última pinta sus candidatos aunque sean de un nombre
   * que ya nadie está buscando. Es el mismo cuidado que en «cerca de aquí», y
   * por el mismo motivo: lo que se ve y lo que se preguntó tienen que coincidir.
   */
  const turno = useRef(0);

  const elegir = useCallback((c: Candidato) => {
    setElegido(c);
    setTexto(c.qid);
    setLista([]);
    setFase('quieto');
  }, []);

  const buscar = useCallback(async (q: string) => {
    if (q.length < 2) return;

    const mio = ++turno.current;
    setFase('buscando');
    setLista([]);
    setVerOtros(false);

    try {
      const res = await fetch(`/api/admin/museo?q=${encodeURIComponent(q)}&lang=${lang}`);
      if (turno.current !== mio) return;

      if (!res.ok) return setFase('error');

      const datos = await res.json() as { museos: Candidato[]; buscado: string };
      setBuscado(datos.buscado ?? q);

      if (!datos.museos?.length) return setFase('nada');
      setFase('quieto');

      /*
       * Un QID pegado no es una lista de candidatos, es una respuesta: o existe
       * o no. Enseñar «elige uno» debajo de un solo resultado sería pedir una
       * decisión que ya está tomada.
       */
      if (ES_QID.test(q) && datos.museos.length === 1) elegir(datos.museos[0]);
      else setLista(datos.museos);
    } catch {
      if (turno.current === mio) setFase('error');
    }
  }, [lang, elegir]);

  /*
   * Un QID pegado se comprueba solo, medio segundo después de dejar de escribir.
   * No es comodidad: preguntarle a WDQS por un QID que no existe tarda treinta
   * segundos en morir con un «504 Gateway Timeout», así que sin esto una Q mal
   * copiada se descubría después de encargar la ingesta y esperar. Un nombre NO
   * se busca solo —eso sería una petición por pulsación a un servicio gratuito—:
   * para eso está el botón.
   */
  useEffect(() => {
    const q = texto.trim();
    if (!ES_QID.test(q) || elegido?.qid === q) return;

    const t = setTimeout(() => buscar(q), 500);
    return () => clearTimeout(t);
  }, [texto, elegido, buscar]);

  const enElMapa = lista.filter((c) => c.situado);
  const sueltos = lista.filter((c) => !c.situado);

  const aviso = (() => {
    if (fase === 'buscando') return 'Buscando en Wikidata…';
    if (fase === 'error') return 'Wikidata no ha contestado. Se puede pegar el QID a mano.';
    if (fase === 'nada') {
      return ES_QID.test(buscado)
        ? `Wikidata no tiene ninguna entidad ${buscado}. Comprueba el número.`
        : `Wikidata no tiene ningún sitio llamado «${buscado}». Prueba con menos palabras.`;
    }
    if (lista.length > 0 && buscado && buscado !== texto.trim()) {
      return `«${texto.trim()}» no coincide con ninguno; buscado como «${buscado}»:`;
    }
    if (lista.length > 0) return 'Elige cuál es:';
    if (!elegido) return 'Escribe el nombre del museo, o pega su QID de Wikidata.';
    return null;
  })();

  return (
    <div className="buscar-museo">
      <div className="buscar-museo-caja">
        <input
          className="campo" name="museum" required pattern="Q[1-9][0-9]*"
          placeholder="Prado, o Q160112" autoComplete="off"
          title="Busca el museo por su nombre y elígelo de la lista, o pega su QID de Wikidata"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setElegido(null);
            setLista([]);
            setFase('quieto');
          }}
          /*
           * Enter busca, nunca encarga. La caja vive dentro del formulario del
           * encargo, así que sin esto pulsar Enter para buscar lanzaría una
           * ingesta de horas con lo que hubiera escrito a medias.
           */
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            buscar(texto.trim());
          }}
        />
        <button
          className="btn" type="button" disabled={texto.trim().length < 2}
          onClick={() => buscar(texto.trim())}
        >
          Buscar
        </button>
      </div>

      {aviso && <p className="muted small buscar-museo-aviso">{aviso}</p>}

      {enElMapa.length > 0 && <Candidatos lista={enElMapa} elegir={elegir} />}

      {/*
        * Los que Wikidata no sitúa se ofrecen, pero guardados.
        *
        * Aquí caen dos cosas muy distintas: el ruido —las seis ediciones del
        * libro «Museo del Prado»— y algún museo de verdad al que nadie le ha
        * puesto coordenadas, como el Museo Picasso Málaga. No hay forma de
        * distinguirlos desde fuera, así que se enseña el número y se deja
        * abrir: quien busque Málaga y no lo vea, sabe dónde mirar.
        */}
      {sueltos.length > 0 && (
        <>
          <button
            type="button" className="buscar-museo-otros"
            onClick={() => setVerOtros((v) => !v)}
          >
            {verOtros ? '▾' : '▸'} {sueltos.length}{' '}
            {sueltos.length === 1 ? 'resultado que Wikidata no sitúa' : 'resultados que Wikidata no sitúa'}
            {' '}en el mapa
          </button>
          {verOtros && <Candidatos lista={sueltos} elegir={elegir} />}
        </>
      )}

      {elegido && (
        <p className="small buscar-museo-elegido">
          <strong>{elegido.nombre}</strong>
          <span className="muted"> · {elegido.qid}</span>
          {elegido.descripcion && <span className="muted"> · {elegido.descripcion}</span>}
          <br />
          {!elegido.situado ? (
            /*
             * Solo se llega aquí pegando un QID: los que se eligen de la lista
             * están todos en el mapa. Se avisa en vez de impedirlo, porque
             * quien pega una Q sabe lo que pega — pero un museo sin coordenadas
             * no puede ser una chincheta, y eso más vale saberlo antes de
             * gastar una ingesta.
             */
            <>
              <span className="sev sev-error">sin coordenadas</span>{' '}
              Wikidata no lo sitúa en ningún punto, así que no saldrá en el mapa.
              ¿Seguro que es el museo y no un libro o un cuadro con su nombre?
            </>
          ) : elegido.catalogo ? (
            <>
              <span className="sev sev-info">ya en el catálogo</span>{' '}
              {formatNumber(lang, elegido.catalogo.obras)} obras
              {elegido.catalogo.ciudad && ` · ${elegido.catalogo.ciudad}`}
              {' · se actualizará · '}
              <Link href={`${path(lang, 'admin')}/corregir/museo/${elegido.catalogo.id}`}>
                ver su ficha
              </Link>
            </>
          ) : (
            <>
              <span className="sev sev-warning">museo nuevo</span>{' '}
              Entra de cero. Cuando termine, hay que repasar su ficha a mano
              —ciudad, país y nombre en los tres idiomas—.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Los candidatos de una búsqueda, cada uno elegible de un clic. */
function Candidatos({ lista, elegir }: { lista: Candidato[]; elegir: (c: Candidato) => void }) {
  return (
    <ul className="buscar-museo-lista">
      {lista.map((c) => (
        <li key={c.qid}>
          <button type="button" onClick={() => elegir(c)}>
            <span className="buscar-museo-nombre">{c.nombre}</span>
            <span className="muted small"> · {c.qid}</span>
            {c.catalogo && <span className="sev sev-info">ya lo tenemos</span>}
            {c.descripcion && <span className="muted small buscar-museo-desc">{c.descripcion}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
