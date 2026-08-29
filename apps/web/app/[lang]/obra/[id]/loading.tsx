import { FichaEsqueleto, Cargando } from '@/components/Esqueleto';

export default function Loading() {
  return (
    <>
      <Cargando que="Cargando la obra" />
      <FichaEsqueleto />
    </>
  );
}
