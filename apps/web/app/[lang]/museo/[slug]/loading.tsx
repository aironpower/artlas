import { CabeceraEsqueleto, MapaEsqueleto, RejillaEsqueleto, Bloque, Cargando } from '@/components/Esqueleto';

/*
 * La forma tiene que ser la de la página real —cabecera, mapa, rejilla— o al
 * llegar los datos todo salta de sitio. Se midió: sin el hueco del mapa, la
 * rejilla bajaba 800 px de golpe, y un brinco molesta más que la espera que
 * esto venía a disimular.
 */
export default function Loading() {
  return (
    <>
      <Cargando que="Cargando el museo" />
      <CabeceraEsqueleto lineas={[30, 92, 78, 26]} />
      <MapaEsqueleto />
      <section style={{ paddingTop: 28 }}>
        <Bloque ancho="26%" alto={22} />
        <RejillaEsqueleto />
      </section>
    </>
  );
}
