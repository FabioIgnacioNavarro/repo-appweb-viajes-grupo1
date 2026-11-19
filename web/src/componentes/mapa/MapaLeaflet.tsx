import React, { useEffect, useRef } from "react";
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

export const MapaLeaflet: React.FC<MapaLeafletProps> = ({
  origen = { latitud: -27.4514, longitud: -58.9866, titulo: "Plaza 25 de Mayo, Resistencia", tipo: "origen" },
  destino = { latitud: -27.4385, longitud: -58.9723, titulo: "Av. Sarmiento y Ruta 16", tipo: "destino" },
  posicionChofer,
  rutaGeoJson,
  altura = "100%",
  onSeleccionarPunto,
}) => {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const marcadoresRef = useRef<{ [key: string]: L.Marker }>({});
  const lineaRutaRef = useRef<L.Polyline | null>(null);

  // Inicializar mapa una sola vez
  useEffect(() => {
    if (!contenedorRef.current || mapaRef.current) return;

    const mapa = L.map(contenedorRef.current, {
      zoomControl: false,
    }).setView([-27.4514, -58.9866], 14);

    L.control.zoom({ position: "bottomright" }).addTo(mapa);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapa);

    mapaRef.current = mapa;

    // Forzar recalculo de dimensiones del contenedor Leaflet
    const timer = setTimeout(() => {
      mapa.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  // Función para crear pines personalizados con diseño SVG nítido
  const crearIconoPin = (tipo: "origen" | "destino" | "chofer") => {
    let colorFondo = "#2563eb"; // Pasajero / Origen (Azul)
    let etiqueta = "A";

    if (tipo === "destino") {
      colorFondo = "#dc2626"; // Destino (Rojo)
      etiqueta = "B";
    } else if (tipo === "chofer") {
      colorFondo = "#059669"; // Chofer (Verde)
      etiqueta = "🚖";
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

  // Actualizar marcadores y polilínea cuando cambian las props
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    // 1. Marcador Origen
    if (origen) {
      if (marcadoresRef.current.origen) {
        marcadoresRef.current.origen.setLatLng([origen.latitud, origen.longitud]);
      } else {
        const marker = L.marker([origen.latitud, origen.longitud], {
          icon: crearIconoPin("origen"),
          draggable: !!onSeleccionarPunto,
        }).addTo(mapa);

        if (origen.titulo) {
          marker.bindPopup(`<strong>Origen:</strong><br>${origen.titulo}`);
        }

        if (onSeleccionarPunto) {
          marker.on("dragend", (e) => {
            const ll = e.target.getLatLng();
            onSeleccionarPunto("origen", [ll.lat, ll.lng]);
          });
        }
        marcadoresRef.current.origen = marker;
      }
    }

    // 2. Marcador Destino
    if (destino) {
      if (marcadoresRef.current.destino) {
        marcadoresRef.current.destino.setLatLng([destino.latitud, destino.longitud]);
      } else {
        const marker = L.marker([destino.latitud, destino.longitud], {
          icon: crearIconoPin("destino"),
          draggable: !!onSeleccionarPunto,
        }).addTo(mapa);

        if (destino.titulo) {
          marker.bindPopup(`<strong>Destino:</strong><br>${destino.titulo}`);
        }

        if (onSeleccionarPunto) {
          marker.on("dragend", (e) => {
            const ll = e.target.getLatLng();
            onSeleccionarPunto("destino", [ll.lat, ll.lng]);
          });
        }
        marcadoresRef.current.destino = marker;
      }
    }

    // 3. Marcador Chofer en Vivo
    if (posicionChofer) {
      if (marcadoresRef.current.chofer) {
        marcadoresRef.current.chofer.setLatLng([posicionChofer.latitud, posicionChofer.longitud]);
      } else {
        const marker = L.marker([posicionChofer.latitud, posicionChofer.longitud], {
          icon: crearIconoPin("chofer"),
        }).addTo(mapa);
        marker.bindPopup(`<strong>Chofer asignado</strong><br>${posicionChofer.titulo || "En camino"}`);
        marcadoresRef.current.chofer = marker;
      }
    }

    // 4. Trazado de Ruta
    if (lineaRutaRef.current) {
      mapa.removeLayer(lineaRutaRef.current);
      lineaRutaRef.current = null;
    }

    if (rutaGeoJson && rutaGeoJson.length > 0) {
      const polilinea = L.polyline(rutaGeoJson, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(mapa);

      lineaRutaRef.current = polilinea;
      mapa.fitBounds(polilinea.getBounds(), { padding: [40, 40] });
    } else if (origen && destino) {
      // Ajustar vista para contener origen y destino
      const bounds = L.latLngBounds([
        [origen.latitud, origen.longitud],
        [destino.latitud, destino.longitud],
      ]);
      mapa.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [origen, destino, posicionChofer, rutaGeoJson, onSeleccionarPunto]);

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-slate-200 shadow-xs" style={{ minHeight: "360px", height: altura }}>
      <div ref={contenedorRef} className="w-full h-full" style={{ minHeight: "360px" }} />
    </div>
  );
};
