import React, { useCallback, useEffect, useRef } from "react";
import L from "leaflet";

export interface PuntoMapa {
  latitud: number;
  longitud: number;
  titulo?: string;
  tipo?: "origen" | "destino" | "chofer";
}

interface MapaLeafletProps {
  origen?: PuntoMapa;
  destino?: PuntoMapa;
  posicionChofer?: PuntoMapa;
  rutaGeoJson?: [number, number][]; // Coordenadas [lat, lng]
  seguirRutaChofer?: boolean;
  altura?: string;
  sinBorde?: boolean;
  onSeleccionarPunto?: (tipo: "origen" | "destino", coords: [number, number]) => void;
}

const ORIGEN_POR_DEFECTO: PuntoMapa = {
  latitud: -27.4521295,
  longitud: -58.9873752,
  titulo: "Juan B. Justo 4 (Plaza 25 de Mayo), Resistencia",
  tipo: "origen",
};

function construirContenidoPopup(etiqueta: string, texto: string): HTMLElement {
  const contenedor = document.createElement("div");
  const fuerte = document.createElement("strong");
  fuerte.textContent = `${etiqueta}:`;
  contenedor.append(fuerte, document.createElement("br"), document.createTextNode(texto));
  return contenedor;
}

/** Proyecta una coordenada sobre la polilínea vial y devuelve su distancia acumulada a lo largo de la ruta. */
function proyectarSobreRuta(
  punto: { latitud: number; longitud: number },
  ruta: [number, number][] | undefined
): { latitud: number; longitud: number; distanciaM: number; separacionM: number } | null {
  if (!ruta || ruta.length < 2) return null;
  const cosLat = Math.cos((punto.latitud * Math.PI) / 180);
  const aMetrosX = (lon: number) => lon * 111_320 * cosLat;
  const aMetrosY = (lat: number) => lat * 110_540;

  const px = aMetrosX(punto.longitud);
  const py = aMetrosY(punto.latitud);
  let mejorDist2 = Number.POSITIVE_INFINITY;
  let mejorLat = punto.latitud;
  let mejorLon = punto.longitud;
  let mejorDistanciaAcum = 0;
  let acum = 0;

  for (let i = 0; i < ruta.length - 1; i++) {
    const [latA, lonA] = ruta[i];
    const [latB, lonB] = ruta[i + 1];
    const ax = aMetrosX(lonA);
    const ay = aMetrosY(latA);
    const bx = aMetrosX(lonB);
    const by = aMetrosY(latB);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const d2 = (px - projX) ** 2 + (py - projY) ** 2;
    if (d2 < mejorDist2) {
      mejorDist2 = d2;
      mejorLat = latA + t * (latB - latA);
      mejorLon = lonA + t * (lonB - lonA);
      mejorDistanciaAcum = acum + len * t;
    }
    acum += len;
  }

  return {
    latitud: mejorLat,
    longitud: mejorLon,
    distanciaM: mejorDistanciaAcum,
    separacionM: Math.sqrt(mejorDist2),
  };
}

/** Obtiene el punto exacto sobre los vértices de la polilínea a una distancia acumulada dada (en metros). */
function puntoEnDistanciaRuta(ruta: [number, number][], distanciaObjetivoM: number): [number, number] {
  if (ruta.length === 0) return [0, 0];
  if (ruta.length === 1 || distanciaObjetivoM <= 0) return ruta[0];
  const cosLat = Math.cos((ruta[0][0] * Math.PI) / 180);
  let acum = 0;
  for (let i = 0; i < ruta.length - 1; i++) {
    const [latA, lonA] = ruta[i];
    const [latB, lonB] = ruta[i + 1];
    const dx = (lonB - lonA) * 111_320 * cosLat;
    const dy = (latB - latA) * 110_540;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (acum + len >= distanciaObjetivoM && len > 0) {
      const t = (distanciaObjetivoM - acum) / len;
      return [latA + (latB - latA) * t, lonA + (lonB - lonA) * t];
    }
    acum += len;
  }
  return ruta[ruta.length - 1];
}

function firmaEncuadre(
  origen: PuntoMapa | undefined,
  destino: PuntoMapa | undefined,
  chofer: PuntoMapa | undefined,
  rutaGeoJson: [number, number][] | undefined
): string {
  const o = origen ? `${origen.latitud.toFixed(5)},${origen.longitud.toFixed(5)}` : "none";
  const d = destino ? `${destino.latitud.toFixed(5)},${destino.longitud.toFixed(5)}` : "none";
  // Solo re-encuadrar cuando el chofer aparece/desaparece, no en cada tick GPS en movimiento
  const c = chofer ? "present" : "none";
  const rLen = rutaGeoJson?.length ?? 0;
  const rIni = rLen > 0 ? `${rutaGeoJson![0]![0].toFixed(5)},${rutaGeoJson![0]![1].toFixed(5)}` : "";
  const rFin = rLen > 1 ? `${rutaGeoJson![rLen - 1]![0].toFixed(5)},${rutaGeoJson![rLen - 1]![1].toFixed(5)}` : "";
  return `${o}|${d}|${c}|${rLen}:${rIni}->${rFin}`;
}

export const MapaLeaflet: React.FC<MapaLeafletProps> = ({
  origen,
  destino,
  posicionChofer,
  rutaGeoJson,
  seguirRutaChofer = false,
  altura = "100%",
  sinBorde = false,
  onSeleccionarPunto,
}) => {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const marcadoresRef = useRef<{ [key: string]: L.Marker }>({});
  const animacionChoferRef = useRef<number | null>(null);
  const distanciaRutaChoferRef = useRef<number | null>(null);
  const lineaRutaRef = useRef<L.Polyline | null>(null);
  const ultimaFirmaEncuadreRef = useRef<string>("");
  const onSeleccionarPuntoRef = useRef(onSeleccionarPunto);
  const origenActualRef = useRef<PuntoMapa | undefined>(origen);
  const destinoActualRef = useRef<PuntoMapa | undefined>(destino);
  const posicionChoferActualRef = useRef<PuntoMapa | undefined>(posicionChofer);
  const rutaActualRef = useRef<[number, number][] | undefined>(rutaGeoJson);

  useEffect(() => {
    onSeleccionarPuntoRef.current = onSeleccionarPunto;
  }, [onSeleccionarPunto]);

  const encuadrarRecorridoCompleto = useCallback(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    const puntos: L.LatLngExpression[] = [];
    if (rutaActualRef.current && rutaActualRef.current.length > 0) {
      for (const p of rutaActualRef.current) puntos.push(p);
    }
    if (origenActualRef.current) {
      puntos.push([origenActualRef.current.latitud, origenActualRef.current.longitud]);
    }
    if (destinoActualRef.current) {
      puntos.push([destinoActualRef.current.latitud, destinoActualRef.current.longitud]);
    }
    if (posicionChoferActualRef.current) {
      puntos.push([posicionChoferActualRef.current.latitud, posicionChoferActualRef.current.longitud]);
    }

    if (puntos.length >= 2) {
      const bounds = L.latLngBounds(puntos);
      mapa.fitBounds(bounds, { padding: [70, 70], maxZoom: 15, animate: true });
    } else if (puntos.length === 1) {
      mapa.setView(puntos[0]!, 15, { animate: true });
    }
  }, []);

  // Inicializar mapa una sola vez
  useEffect(() => {
    if (!contenedorRef.current || mapaRef.current) return;

    const mapa = L.map(contenedorRef.current, {
      zoomControl: false,
    }).setView([ORIGEN_POR_DEFECTO.latitud, ORIGEN_POR_DEFECTO.longitud], 14);

    L.control.zoom({ position: "bottomright" }).addTo(mapa);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapa);

    mapaRef.current = mapa;

    mapa.on("click", (evento: L.LeafletMouseEvent) => {
      const cb = onSeleccionarPuntoRef.current;
      if (!cb) return;
      cb(origenActualRef.current ? "destino" : "origen", [evento.latlng.lat, evento.latlng.lng]);
    });

    const timer = setTimeout(() => {
      mapa.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      mapa.remove();
      mapaRef.current = null;
      marcadoresRef.current = {};
      lineaRutaRef.current = null;
      ultimaFirmaEncuadreRef.current = "";
    };
  }, []);

  const crearIconoPin = (tipo: "origen" | "destino" | "chofer") => {
    let colorFondo = "#2563eb";
    let etiqueta = "A";

    if (tipo === "destino") {
      colorFondo = "#dc2626";
      etiqueta = "B";
    } else if (tipo === "chofer") {
      colorFondo = "#059669";
      etiqueta = "C";
    }

    const html = `
      <div style="
        background-color: ${colorFondo};
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 13px;
        border: 2.5px solid white;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      ">
        ${etiqueta}
      </div>
    `;

    return L.divIcon({
      className: "custom-leaflet-pin",
      html,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18],
    });
  };

  // Actualizar marcadores, popups y polilínea; encuadrar solo cuando cambian las coordenadas reales
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    origenActualRef.current = origen;
    destinoActualRef.current = destino;
    posicionChoferActualRef.current = posicionChofer;
    rutaActualRef.current = rutaGeoJson;

    const sincronizarMarcador = (
      clave: "origen" | "destino" | "chofer",
      punto: PuntoMapa | undefined,
      etiquetaPopup: string,
      arrastrable: boolean
    ) => {
      const existente = marcadoresRef.current[clave];
      if (!punto) {
        if (clave === "chofer") {
          if (animacionChoferRef.current !== null) {
            window.cancelAnimationFrame(animacionChoferRef.current);
            animacionChoferRef.current = null;
          }
          distanciaRutaChoferRef.current = null;
        }
        if (existente) {
          mapa.removeLayer(existente);
          delete marcadoresRef.current[clave];
        }
        return;
      }

      const textoPopup = punto.titulo || (clave === "chofer" ? "En camino" : etiquetaPopup);

      if (existente) {
        if (clave === "chofer") {
          if (animacionChoferRef.current !== null) {
            window.cancelAnimationFrame(animacionChoferRef.current);
            animacionChoferRef.current = null;
          }
          const proyeccion =
            seguirRutaChofer && rutaGeoJson && rutaGeoJson.length >= 2
              ? proyectarSobreRuta(punto, rutaGeoJson)
              : null;

          if (proyeccion && proyeccion.separacionM <= 250 && rutaGeoJson) {
            const sInicio = distanciaRutaChoferRef.current ?? proyeccion.distanciaM;
            const sFin = Math.max(sInicio, proyeccion.distanciaM);
            const duracionMs = 420;
            const t0 = performance.now();
            const animarSobreRuta = (ahora: number) => {
              const progreso = Math.min(1, (ahora - t0) / duracionMs);
              const sActual = sInicio + (sFin - sInicio) * progreso;
              distanciaRutaChoferRef.current = sActual;
              existente.setLatLng(puntoEnDistanciaRuta(rutaGeoJson, sActual));
              if (progreso < 1) {
                animacionChoferRef.current = window.requestAnimationFrame(animarSobreRuta);
              } else {
                animacionChoferRef.current = null;
              }
            };
            animacionChoferRef.current = window.requestAnimationFrame(animarSobreRuta);
          } else {
            distanciaRutaChoferRef.current = null;
            const inicio = existente.getLatLng();
            const deltaLat = punto.latitud - inicio.lat;
            const deltaLon = punto.longitud - inicio.lng;
            if (Math.abs(deltaLat) > 1e-6 || Math.abs(deltaLon) > 1e-6) {
              const duracionMs = 420;
              const t0 = performance.now();
              const animar = (ahora: number) => {
                const progreso = Math.min(1, (ahora - t0) / duracionMs);
                existente.setLatLng([inicio.lat + deltaLat * progreso, inicio.lng + deltaLon * progreso]);
                if (progreso < 1) {
                  animacionChoferRef.current = window.requestAnimationFrame(animar);
                } else {
                  animacionChoferRef.current = null;
                }
              };
              animacionChoferRef.current = window.requestAnimationFrame(animar);
            }
          }
        } else {
          existente.setLatLng([punto.latitud, punto.longitud]);
        }
        existente.setPopupContent(construirContenidoPopup(etiquetaPopup, textoPopup));
        if (arrastrable && existente.dragging) {
          existente.dragging.enable();
        } else if (existente.dragging) {
          existente.dragging.disable();
        }
      } else {
        const marker = L.marker([punto.latitud, punto.longitud], {
          icon: crearIconoPin(clave),
          draggable: arrastrable,
        }).addTo(mapa);

        marker.bindPopup(construirContenidoPopup(etiquetaPopup, textoPopup));

        if (clave === "origen" || clave === "destino") {
          marker.on("dragend", (e) => {
            const cb = onSeleccionarPuntoRef.current;
            if (!cb) return;
            const ll = e.target.getLatLng();
            cb(clave, [ll.lat, ll.lng]);
          });
        }

        marcadoresRef.current[clave] = marker;
      }
    };

    const draggable = Boolean(onSeleccionarPuntoRef.current);
    const proyeccionInicial =
      seguirRutaChofer && posicionChofer && rutaGeoJson && rutaGeoJson.length >= 2
        ? proyectarSobreRuta(posicionChofer, rutaGeoJson)
        : null;
    const choferAlineado =
      posicionChofer && proyeccionInicial && proyeccionInicial.separacionM <= 250
        ? { ...posicionChofer, latitud: proyeccionInicial.latitud, longitud: proyeccionInicial.longitud }
        : posicionChofer;
    if (!seguirRutaChofer) {
      distanciaRutaChoferRef.current = null;
    }
    sincronizarMarcador("origen", origen, "Origen", draggable);
    sincronizarMarcador("destino", destino, "Destino", draggable);
    sincronizarMarcador("chofer", choferAlineado, "Chofer asignado", false);

    // 4. Trazado de Ruta completo (siempre dibuja si hay >= 2 puntos)
    if (lineaRutaRef.current) {
      mapa.removeLayer(lineaRutaRef.current);
      lineaRutaRef.current = null;
    }

    const puntosLinea: [number, number][] =
      rutaGeoJson && rutaGeoJson.length >= 2 ? rutaGeoJson : [];

    if (puntosLinea.length >= 2) {
      const polilinea = L.polyline(puntosLinea, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(mapa);
      lineaRutaRef.current = polilinea;
    }

    // 5. Encuadrar vista SOLO cuando cambian coordenadas/recorrido reales (evita robar zoom/pan al usuario)
    const firmaActual = firmaEncuadre(origen, destino, posicionChofer, puntosLinea);
    if (firmaActual !== ultimaFirmaEncuadreRef.current) {
      ultimaFirmaEncuadreRef.current = firmaActual;
      encuadrarRecorridoCompleto();
    }
  }, [origen, destino, posicionChofer, rutaGeoJson, seguirRutaChofer, encuadrarRecorridoCompleto]);

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${
        sinBorde ? "" : "rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs"
      }`}
      style={{ minHeight: "360px", height: altura }}
    >
      <div ref={contenedorRef} className="w-full h-full" style={{ minHeight: "360px" }} />
      <button
        type="button"
        onClick={encuadrarRecorridoCompleto}
        className="absolute top-3 right-3 z-[400] rounded-lg border border-slate-300 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-xs hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100"
        title="Centrar y encuadrar el origen o el recorrido completo"
        aria-label="Centrar mapa"
      >
        Centrar mapa
      </button>
    </div>
  );
};
