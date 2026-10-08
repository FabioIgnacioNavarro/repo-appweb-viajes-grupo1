import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { crearCalculadorRuta } from "./rutas";
import { type Coordenada, type Estimacion, crearEstimacionConRuta } from "./viaje";

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function leerCoordenada(valor: unknown): Coordenada | undefined {
  if (!esObjeto(valor)) return undefined;
  const { latitud, longitud } = valor;
  if (typeof latitud !== "number" || typeof longitud !== "number") return undefined;
  if (!Number.isFinite(latitud) || latitud < -90 || latitud > 90) return undefined;
  if (!Number.isFinite(longitud) || longitud < -180 || longitud > 180) return undefined;
  return { latitud, longitud };
}

const valorPuerto = process.env.PUERTO_DEMO_WEB ?? "3000";
const puerto = Number(valorPuerto);

if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  throw new Error("PUERTO_DEMO_WEB debe ser un número entero entre 1 y 65535.");
}

const aplicacion = express();
const carpetaWeb = path.resolve(process.cwd(), "web");
const calculadorRuta = crearCalculadorRuta();
const estimacionesVigentes = new Map<string, Estimacion>();

aplicacion.use(express.json({ limit: "10kb" }));

aplicacion.get("/health", (_pedido, respuesta) => {
  respuesta.status(200).json({ estado: "activo" });
});

aplicacion.get("/ready", (_pedido, respuesta) => {
  respuesta.status(503).json({
    estado: "no_listo",
    dependencias: { base_datos: "no_configurada" }
  });
});

async function manejarEstimacion(pedido: express.Request, respuesta: express.Response): Promise<void> {
  const cuerpo: unknown = pedido.body;
  const origen = esObjeto(cuerpo) ? leerCoordenada(cuerpo.origen) : undefined;
  const destino = esObjeto(cuerpo) ? leerCoordenada(cuerpo.destino) : undefined;
  if (!origen || !destino) {
    respuesta.status(400).json({
      error: {
        codigo: "COORDENADAS_INVALIDAS",
        mensaje: "Indicá origen y destino con latitud y longitud válidas."
      }
    });
    return;
  }

  try {
    const estimacion = await crearEstimacionConRuta(origen, destino, calculadorRuta);
    const ahora = Date.now();
    for (const [id, estimacionGuardada] of estimacionesVigentes) {
      if (Date.parse(estimacionGuardada.vigenteHasta) <= ahora) estimacionesVigentes.delete(id);
    }

    const idEstimacion = randomUUID();
    estimacionesVigentes.set(idEstimacion, estimacion);
    respuesta.status(201).json({
      id_estimacion: idEstimacion,
      distancia_metros: estimacion.distanciaMetros,
      duracion_segundos: estimacion.duracionSegundos,
      precio_estimado: String(estimacion.precioEstimado),
      moneda: estimacion.moneda,
      multiplicador_demanda: estimacion.multiplicadorDemanda,
      proveedor_ruta: estimacion.proveedorRuta,
      polilinea: estimacion.polilinea ?? null,
      creada_en: estimacion.creadaEn,
      vigente_hasta: estimacion.vigenteHasta
    });
  } catch {
    respuesta.status(502).json({
      error: {
        codigo: "ESTIMACION_NO_DISPONIBLE",
        mensaje: "No se pudo calcular el precio y el recorrido. Revisá la conexión e intentá otra vez."
      }
    });
  }
}

aplicacion.post("/viajes/estimacion", manejarEstimacion);
aplicacion.post("/demostracion/estimaciones", manejarEstimacion);
aplicacion.use(express.static(carpetaWeb));
aplicacion.listen(puerto, () => {
  console.log(`Demo web disponible en http://localhost:${puerto}`);
});
