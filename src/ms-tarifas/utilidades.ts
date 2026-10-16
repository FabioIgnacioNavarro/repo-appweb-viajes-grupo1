import type { Coordenada } from "./dominio";

export function distanceHaversineMetros(origen: Coordenada, destino: Coordenada): number {
  const radio = 6_371_000;
  const radianes = (grados: number) => grados * Math.PI / 180;
  const deltaLatitud = radianes(destino.latitud - origen.latitud);
  const deltaLongitud = radianes(destino.longitud - origen.longitud);
  const a = Math.sin(deltaLatitud / 2) ** 2
    + Math.cos(radianes(origen.latitud)) * Math.cos(radianes(destino.latitud)) * Math.sin(deltaLongitud / 2) ** 2;
  return Math.round(radio * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
