import { CabeceraEsqueleto, FiltrosEsqueleto, RejillaEsqueleto, Cargando } from '@/components/Esqueleto';

export default function Loading() {
  return (
    <>
      <Cargando que="Buscando" />
      <CabeceraEsqueleto />
      <FiltrosEsqueleto />
      <RejillaEsqueleto />
    </>
  );
}
