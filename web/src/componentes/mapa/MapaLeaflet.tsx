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
  altura?: string;
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

function firmaEncuadre(
  origen: PuntoMapa | undefined,
  destino: PuntoMapa | undefined,
  rutaGeoJson: [number, number][] | undefined
): string {
  const o = origen ? `${origen.latitud.toFixed(5)},${origen.longitud.toFixed(5)}` : "none";
  const d = destino ? `${destino.latitud.toFixed(5)},${destino.longitud.toFixed(5)}` : "none";
  const rLen = rutaGeoJson?.length ?? 0;
  const rIni = rLen > 0 ? `${rutaGeoJson![0]![0].toFixed(5)},${rutaGeoJson![0]![1].toFixed(5)}` : "";
  const rFin = rLen > 1 ? `${rutaGeoJson![rLen - 1]![0].toFixed(5)},${rutaGeoJson![rLen - 1]![1].toFixed(5)}` : "";
  return `${o}|${d}|${rLen}:${rIni}->${rFin}`;
}

export const MapaLeaflet: React.FC<MapaLeafletProps> = ({
  origen = ORIGEN_POR_DEFECTO,
  destino,
  posicionChofer,
  rutaGeoJson,
  altura = "100%",
  onSeleccionarPunto,
}) => {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const marcadoresRef = useRef<{ [key: string]: L.Marker }>({});
  const lineaRutaRef = useRef<L.Polyline | null>(null);
  const ultimaFirmaEncuadreRef = useRef<string>("");
  const onSeleccionarPuntoRef = useRef(onSeleccionarPunto);
  const origenActualRef = useRef<PuntoMapa | undefined>(origen);
  const destinoActualRef = useRef<PuntoMapa | undefined>(destino);
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
      cb("destino", [evento.latlng.lat, evento.latlng.lng]);
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
    rutaActualRef.current = rutaGeoJson;

    const sincronizarMarcador = (
      clave: "origen" | "destino" | "chofer",
      punto: PuntoMapa | undefined,
      etiquetaPopup: string,
      arrastrable: boolean
    ) => {
      const existente = marcadoresRef.current[clave];
      if (!punto) {
        if (existente) {
          mapa.removeLayer(existente);
          delete marcadoresRef.current[clave];
        }
        return;
      }

      const textoPopup = punto.titulo || (clave === "chofer" ? "En camino" : etiquetaPopup);

      if (existente) {
        existente.setLatLng([punto.latitud, punto.longitud]);
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
    sincronizarMarcador("origen", origen, "Origen", draggable);
    sincronizarMarcador("destino", destino, "Destino", draggable);
    sincronizarMarcador("chofer", posicionChofer, "Chofer asignado", false);

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
    const firmaActual = firmaEncuadre(origen, destino, puntosLinea);
    if (firmaActual !== ultimaFirmaEncuadreRef.current) {
      ultimaFirmaEncuadreRef.current = firmaActual;
      encuadrarRecorridoCompleto();
    }
  }, [origen, destino, posicionChofer, rutaGeoJson, encuadrarRecorridoCompleto]);

  return (
    <div
      className="relative w-full h-full rounded-xl overflow-hidden border border-slate-200 shadow-xs"
      style={{ minHeight: "360px", height: altura }}
    >
      <div ref={contenedorRef} className="w-full h-full" style={{ minHeight: "360px" }} />
      <button
        type="button"
        onClick={encuadrarRecorridoCompleto}
        className="absolute top-3 right-3 z-[400] rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-xs hover:bg-slate-50 cursor-pointer"
        title="Alejar o acercar el mapa para ver el viaje completo"
      >
        Ver recorrido
      </button>
    </div>
  );
};
