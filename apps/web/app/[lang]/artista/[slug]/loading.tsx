import { CabeceraEsqueleto, MapaEsqueleto, RejillaEsqueleto, Bloque, Cargando } from '@/components/Esqueleto';

/*
 * Cuatro líneas de cabecera, que es lo que menos salto dio al medirlo: 78 px
 * frente a los 139 de dos y los 808 de no reservar el mapa.
 *
 * No hay un número que valga para todos y no merece la pena seguir afinándolo:
 * la cabecera de un artista mide lo que midan sus fechas, su nacionalidad y su
 * descripción, así que cualquier esqueleto acierta con unos y falla con otros.
 * Lo que importaba —que la rejilla no bajara media pantalla— está resuelto.
 */
export default function Loading() {
  return (
    <>
      <Cargando que="Cargando el artista" />
      <CabeceraEsqueleto lineas={[30, 92, 78, 26]} />
      <MapaEsqueleto />
      <section style={{ paddingTop: 28 }}>
        <Bloque ancho="26%" alto={22} />
        <RejillaEsqueleto />
      </section>
    </>
  );
}
