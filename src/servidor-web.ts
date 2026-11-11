import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { crearCalculadorRuta, crearGeocodificador } from "./rutas";
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
const carpetaLegacy = path.resolve(process.cwd(), "web/legacy-demo");
const carpetaWeb = fs.existsSync(carpetaLegacy) ? carpetaLegacy : path.resolve(process.cwd(), "web");
const calculadorRuta = crearCalculadorRuta();
const geocodificador = crearGeocodificador();
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

const CENTRO_PREDETERMINADO_DEMO: Coordenada = { latitud: -27.451, longitud: -58.986 };

aplicacion.post("/demostracion/geocodificar", async (pedido, respuesta) => {
  const cuerpo: unknown = pedido.body;
  const direccion = esObjeto(cuerpo) && typeof cuerpo.direccion === "string" ? cuerpo.direccion.trim() : undefined;
  if (!direccion) {
    respuesta.status(400).json({
      error: {
        codigo: "DIRECCION_INVALIDA",
        mensaje: "Ingresá una dirección o nombre de lugar a buscar."
      }
    });
    return;
  }
  const proximidad = (esObjeto(cuerpo) ? leerCoordenada(cuerpo.proximidad) : undefined) ?? CENTRO_PREDETERMINADO_DEMO;
  try {
    const coordenada = await geocodificador.geocodificar(direccion, { centro: proximidad });
    respuesta.status(200).json({ direccion, coordenada });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No se pudo geocodificar la dirección.";
    respuesta.status(404).json({
      error: {
        codigo: "DIRECCION_NO_ENCONTRADA",
        mensaje
      }
    });
  }
});

aplicacion.post("/demostracion/geocodificar-inversa", async (pedido, respuesta) => {
  const coordenada = leerCoordenada(pedido.body);
  if (!coordenada) {
    respuesta.status(400).json({
      error: {
        codigo: "COORDENADAS_INVALIDAS",
        mensaje: "Indicá una latitud y longitud válidas para resolver la dirección."
      }
    });
    return;
  }
  try {
    const direccion = geocodificador.geocodificarInversa
      ? await geocodificador.geocodificarInversa(coordenada)
      : `Ubicación (${coordenada.latitud.toFixed(4)}, ${coordenada.longitud.toFixed(4)})`;
    respuesta.status(200).json({ direccion, coordenada });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No se pudo determinar la dirección del punto.";
    respuesta.status(404).json({
      error: {
        codigo: "DIRECCION_NO_ENCONTRADA",
        mensaje
      }
    });
  }
});

async function resolverPuntoDemo(valor: unknown, centroProximidad = CENTRO_PREDETERMINADO_DEMO): Promise<Coordenada | undefined> {
  const coord = leerCoordenada(valor);
  if (coord) return coord;
  if (esObjeto(valor) && typeof valor.direccion === "string" && valor.direccion.trim()) {
    try {
      return await geocodificador.geocodificar(valor.direccion.trim(), { centro: centroProximidad });
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function manejarEstimacion(pedido: express.Request, respuesta: express.Response): Promise<void> {
  const cuerpo: unknown = pedido.body;
  const origen = await resolverPuntoDemo(esObjeto(cuerpo) ? cuerpo.origen : undefined, CENTRO_PREDETERMINADO_DEMO);
  const destino = await resolverPuntoDemo(esObjeto(cuerpo) ? cuerpo.destino : undefined, origen ?? CENTRO_PREDETERMINADO_DEMO);
  if (!origen || !destino) {
    respuesta.status(400).json({
      error: {
        codigo: "COORDENADAS_INVALIDAS",
        mensaje: "Indicá origen y destino con latitud y longitud válidas o una dirección reconocida."
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
      vigente_hasta: estimacion.vigenteHasta,
      origen,
      destino
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
if (fs.existsSync(carpetaLegacy)) {
  aplicacion.use("/legacy-demo", express.static(carpetaLegacy));
}
aplicacion.listen(puerto, () => {
  console.log(`Demo web disponible en http://localhost:${puerto}`);
});
