import "dotenv/config";
import express from "express";
import { ValidadorJwtJwks } from "../compartido/jwt";
import { ValidadorJwtFalso } from "../compartido/jwt-falso";
import {
  AceptarOferta, AsignadorAtomicoMemoria, AvanzarViaje, CancelarViaje, ConfirmarViaje,
  ConsultarViaje, FinalizarViaje, GeneradorIdMemoria, RechazarOferta,
  RepositorioCobrosMemoria, RepositorioIdempotenciaMemoria, RepositorioOfertasMemoria,
  RepositorioViajesMemoria, type ActorAutenticado, type EstimacionVigente
} from "./dominio";
import { crearRouterViajes } from "./http";

const puerto = Number(process.env.PUERTO_MS_VIAJES ?? 3000);
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error("PUERTO_MS_VIAJES debe ser un entero entre 1 y 65535.");
const requerido = (nombre: string): string => { const valor = process.env[nombre]; if (!valor) throw new Error(`${nombre} es obligatoria.`); return valor; };
const token = process.env.JWT_MODO === "falso"
  ? new ValidadorJwtFalso()
  : new ValidadorJwtJwks({ jwksUrl: requerido("JWT_JWKS_URL"), emisor: requerido("JWT_ISSUER"), audiencia: requerido("JWT_AUDIENCE"), campoRol: process.env.JWT_ROLE_CLAIM ?? "rol" });
const viajes = new RepositorioViajesMemoria();
const ofertas = new RepositorioOfertasMemoria();
const cobros = new RepositorioCobrosMemoria();
const ids = new GeneradorIdMemoria();
const asignador = new AsignadorAtomicoMemoria();
const estimaciones = async (actor: ActorAutenticado, id: string, jwt: string): Promise<EstimacionVigente | undefined> => {
  const base = process.env.MS_TARIFAS_URL ?? "http://ms-tarifas:3001";
  let respuesta: Response;
  try { respuesta = await fetch(`${base}/estimaciones/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(1500) }); }
  catch { return undefined; }
  if (!respuesta.ok) return undefined;
  const cuerpo = await respuesta.json() as Record<string, unknown>;
  if (typeof cuerpo.id_estimacion !== "string" || typeof cuerpo.precio_estimado !== "string" || typeof cuerpo.vigente_hasta !== "string") return undefined;
  const origen = coordenada(cuerpo.origen); const destino = coordenada(cuerpo.destino);
  if (!origen || !destino || actor.rol !== "PASAJERO") return undefined;
  return {
    id: cuerpo.id_estimacion, origen, destino, precioEstimado: cuerpo.precio_estimado, moneda: "ARS",
    multiplicadorDemanda: typeof cuerpo.multiplicador_demanda === "number" ? cuerpo.multiplicador_demanda : 1,
    factoresPrecio: objeto(cuerpo.factores_precio) ? cuerpo.factores_precio : {},
    creadaEn: new Date(String(cuerpo.creada_en)), vigenteHasta: new Date(cuerpo.vigente_hasta)
  };
};
const dependencias = {
  viajes, ofertas,
  confirmar: new ConfirmarViaje(viajes, new RepositorioIdempotenciaMemoria(), ids),
  aceptar: new AceptarOferta(ofertas, viajes, asignador),
  rechazar: new RechazarOferta(ofertas),
  cancelar: new CancelarViaje(viajes, asignador),
  avanzar: new AvanzarViaje(viajes),
  finalizar: new FinalizarViaje(viajes, cobros, asignador, ids),
  consultar: new ConsultarViaje(viajes),
  validadorToken: token,
  obtenerEstimacion: estimaciones
};
const aplicacion = express();
aplicacion.get("/health", (_pedido, respuesta) => respuesta.json({ estado: "activo", servicio: "ms-viajes" }));
aplicacion.get("/ready", (_pedido, respuesta) => respuesta.json({ estado: "listo", servicio: "ms-viajes" }));
aplicacion.use(crearRouterViajes(dependencias));
aplicacion.listen(puerto, () => console.log(`ms-viajes disponible en http://localhost:${puerto}`));

function objeto(valor: unknown): valor is Record<string, unknown> { return typeof valor === "object" && valor !== null && !Array.isArray(valor); }
function coordenada(valor: unknown): { latitud: number; longitud: number } | undefined {
  if (!objeto(valor) || typeof valor.latitud !== "number" || typeof valor.longitud !== "number") return undefined;
  return { latitud: valor.latitud, longitud: valor.longitud };
}
