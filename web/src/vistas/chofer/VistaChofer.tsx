import React, { useCallback, useEffect, useRef, useState } from "react";
import { clienteApi, ErrorHttpApi } from "../../nucleo/api";
import { obtenerSesion } from "../../nucleo/sesion";
import { clienteTiempoReal, EstadoConexionWs } from "../../nucleo/ws";
import { useModoDesarrollador } from "../../nucleo/modoDesarrollador";
import { IndicadorConexionTiempoReal, SeguimientoMapaEnVivo } from "../../componentes/seguimiento";
import { IconoAlerta, IconoAuto, IconoCheck, IconoPin, IconoRayo, Modal } from "../../componentes/comunes";

export interface CoordenadaChofer {
  latitud: number;
  longitud: number;
  direccion?: string;
}

export interface OfertaDto {
  id_oferta: string;
  id_viaje: string;
  id_chofer: string;
  estado: "pendiente" | "aceptada" | "rechazada" | "vencida" | "cancelada" | "no_seleccionada";
  enviada_en: string;
  expira_en: string;
  respondida_en?: string;
  motivo?: string;
  origen?: CoordenadaChofer;
  destino?: CoordenadaChofer;
  precio_estimado?: string;
  moneda?: string;
}

export interface ViajeChoferDto {
  id_viaje: string;
  pasajero_id: string;
  chofer_id: string | null;
  origen: CoordenadaChofer;
  destino: CoordenadaChofer;
  id_estimacion: string;
  precio_estimado: string;
  precio_final: string | null;
  moneda: string;
  multiplicador_demanda: number;
  factores_precio: Record<string, unknown>;
  estado: string;
  creado_en: string;
  iniciado_en?: string;
  finalizado_en?: string;
  cancelado_en?: string;
  motivo_cancelacion?: string | null;
}

export interface CobroChoferDto {
  id_cobro: string;
  importe: string;
  moneda: string;
  estado: "pendiente" | "fallido" | "confirmado";
}

const ESTADOS_ACTIVOS_CHOFER = new Set(["asignado", "chofer_en_camino", "en_curso"]);
const ESTADOS_HISTORIAL_CHOFER = new Set([
  "finalizado",
  "cancelado_por_pasajero",
  "cancelado_por_chofer",
  "cancelado_por_operador",
  "cancelado",
]);

export function calcularSegundosRestantes(expiraEnIso: string, ahoraMs = Date.now()): number {
  const expiraMs = Date.parse(expiraEnIso);
  if (Number.isNaN(expiraMs)) return 0;
  return Math.max(0, Math.ceil((expiraMs - ahoraMs) / 1000));
}

export function formatearImporteArs(importe?: string): string {
  if (!importe) return "$ — ARS";
  const limpio = String(importe).replace(/[^\d]/g, "");
  if (!limpio) return `$ ${importe} ARS`;
  return `$ ${BigInt(limpio).toLocaleString("es-AR")} ARS`;
}

export function etiquetaEstadoViaje(estado?: string): string {
  switch ((estado ?? "").toLowerCase()) {
    case "asignado":
      return "Asignado (Ir a buscar pasajero)";
    case "chofer_en_camino":
      return "Chofer en camino al origen";
    case "en_curso":
      return "Viaje en curso";
    case "finalizado":
      return "Viaje finalizado";
    case "cancelado_por_pasajero":
    case "cancelado_por_chofer":
    case "cancelado_por_operador":
    case "cancelado":
      return "Viaje cancelado";
    default:
      return "Esperando aceptación";
  }
}

/**
 * Vista de Chofer — Asignada a Valentino (Flujo B: WEB-006 y WEB-007)
 */
export const VistaChofer: React.FC = () => {
  const sesion = obtenerSesion();
  const { modoDev } = useModoDesarrollador();
  const idChoferActual = sesion?.idUsuario ?? "11111111-1111-4111-8111-111111111111";

  // Disponibilidad en ms-flota
  const [disponible, setDisponible] = useState<boolean>(false);
  const disponibleRef = useRef<boolean>(false);
  const [cargandoDisponibilidad, setCargandoDisponibilidad] = useState<boolean>(false);

  useEffect(() => {
    disponibleRef.current = disponible;
  }, [disponible]);

  // Ubicación por dirección (geocodificada automáticamente) y envío automático cada 2s en ms-flota
  const [direccionInput, setDireccionInput] = useState<string>("");
  const [sugerenciasDireccion, setSugerenciasDireccion] = useState<
    Array<{ etiqueta: string; latitud: number; longitud: number }>
  >([]);
  const [buscandoDireccion, setBuscandoDireccion] = useState<boolean>(false);
  const [latitudInput, setLatitudInput] = useState<string>("-27.4512");
  const [longitudInput, setLongitudInput] = useState<string>("-58.9866");
  const latitudRef = useRef<string>(latitudInput);
  const longitudRef = useRef<string>(longitudInput);
  const debounceDireccionRef = useRef<number | null>(null);
  const secuenciaDireccionRef = useRef<number>(0);
  useEffect(() => {
    latitudRef.current = latitudInput;
    longitudRef.current = longitudInput;
  }, [latitudInput, longitudInput]);
  useEffect(() => () => {
    if (debounceDireccionRef.current !== null) {
      window.clearTimeout(debounceDireccionRef.current);
    }
  }, []);
  const [ultimaUbicacion, setUltimaUbicacion] = useState<{
    latitud: number;
    longitud: number;
    actualizado_at: string;
    etiqueta?: string;
  } | null>(null);
  const [enviandoUbicacion, setEnviandoUbicacion] = useState<boolean>(false);

  // Ofertas y cuenta regresiva de 60s
  const [ofertas, setOfertas] = useState<OfertaDto[]>([]);
  const [idOfertaEmergente, setIdOfertaEmergente] = useState<string | null>(null);
  const [ahoraMs, setAhoraMs] = useState<number>(() => Date.now());
  const [procesandoOfertaId, setProcesandoOfertaId] = useState<string | null>(null);

  // El viaje activo queda separado del historial persistido del chofer.
  const [viajeActivo, setViajeActivo] = useState<ViajeChoferDto | null>(null);
  const [viajeCerradoReciente, setViajeCerradoReciente] = useState<ViajeChoferDto | null>(null);
  const [viajesChofer, setViajesChofer] = useState<ViajeChoferDto[]>([]);
  const [mostrarHistorialViajes, setMostrarHistorialViajes] = useState(false);
  const [ultimoCobro, setUltimoCobro] = useState<CobroChoferDto | null>(null);
  const [procesandoTransicion, setProcesandoTransicion] = useState<boolean>(false);
  const [resultadoFinalizacion, setResultadoFinalizacion] = useState<{ tipo: "exito" | "error"; mensaje: string } | null>(null);
  const [viajeConsultandoCobro, setViajeConsultandoCobro] = useState<string | null>(null);
  const [resultadoCobroHistorial, setResultadoCobroHistorial] = useState<{
    idViaje: string;
    tipo: "exito" | "error";
    mensaje: string;
  } | null>(null);

  // Alertas y errores (ej. 409 Conflict)
  const [alertaError, setAlertaError] = useState<{ codigo: string; mensaje: string; esConflicto409?: boolean } | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [estadoWs, setEstadoWs] = useState<EstadoConexionWs>(clienteTiempoReal.obtenerEstado());

  const tieneViajeEnCurso = Boolean(viajeActivo && ESTADOS_ACTIVOS_CHOFER.has(viajeActivo.estado.toLowerCase()));

  const guardarViajeEnLista = (viaje: ViajeChoferDto) => {
    setViajesChofer((prev) => [viaje, ...prev.filter((item) => item.id_viaje !== viaje.id_viaje)]);
  };

  // Sincronizar estado inicial desde backend (GET chofer, ofertas y viajes)
  const sincronizarEstadoServidor = useCallback(async () => {
    try {
      const respChofer = await clienteApi
        .get<{
          chofer: { disponibilidad: boolean };
          ubicacion: { latitud: number; longitud: number; actualizado_at: string } | null;
        }>(`/choferes/${encodeURIComponent(idChoferActual)}`)
        .catch(() => null);

      if (respChofer?.chofer) {
        const estaDisponible = Boolean(respChofer.chofer.disponibilidad);
        disponibleRef.current = estaDisponible;
        setDisponible(estaDisponible);
      }
      if (respChofer?.ubicacion) {
        setUltimaUbicacion({
          latitud: respChofer.ubicacion.latitud,
          longitud: respChofer.ubicacion.longitud,
          actualizado_at: respChofer.ubicacion.actualizado_at,
        });
        setLatitudInput(String(respChofer.ubicacion.latitud));
        setLongitudInput(String(respChofer.ubicacion.longitud));
      }

      const [respOfertas, respViajes] = await Promise.all([
        clienteApi.get<{ ofertas: OfertaDto[] }>("/choferes/yo/ofertas").catch(() => null),
        clienteApi.get<{ viajes: ViajeChoferDto[] }>("/viajes").catch(() => null),
      ]);

      const mapaViajes = new Map<string, ViajeChoferDto>();
      if (respViajes?.viajes) {
        // Las ofertas apuntan a viajes todavía sin asignar; se usan para completar sus detalles.
        for (const v of respViajes.viajes) {
          mapaViajes.set(v.id_viaje, v);
        }
        const propios = respViajes.viajes.filter((v) => v.chofer_id === idChoferActual);
        const activo = propios.find(
          (v) => v.chofer_id === idChoferActual && ESTADOS_ACTIVOS_CHOFER.has(v.estado.toLowerCase())
        );
        setViajesChofer((prev) => {
          const idsServidor = new Set(propios.map((v) => v.id_viaje));
          const viajesDemo = prev.filter((v) => v.id_viaje.startsWith("viaje-demo-") && !idsServidor.has(v.id_viaje));
          return [...propios, ...viajesDemo];
        });
        setViajeActivo(activo ?? null);
        const cerradoReciente = propios
          .filter((v) => ESTADOS_HISTORIAL_CHOFER.has(v.estado.toLowerCase()))
          .sort((a, b) => Date.parse(b.finalizado_en ?? b.cancelado_en ?? b.creado_en) - Date.parse(a.finalizado_en ?? a.cancelado_en ?? a.creado_en))[0];
        setViajeCerradoReciente(activo ? null : cerradoReciente ?? null);
      }

      if (respOfertas?.ofertas) {
        const delServidor = respOfertas.ofertas.map((of) => {
          const v = mapaViajes.get(of.id_viaje);
          return {
            ...of,
            origen: of.origen ?? v?.origen,
            destino: of.destino ?? v?.destino,
            precio_estimado: of.precio_estimado ?? v?.precio_estimado,
            moneda: of.moneda ?? v?.moneda ?? "ARS",
          };
        });
        setOfertas((prev) => {
          const idsServidor = new Set(delServidor.map((o) => o.id_oferta));
          const ofertasWsEnVuelo = prev.filter((o) => !idsServidor.has(o.id_oferta));
          return [...delServidor, ...ofertasWsEnVuelo];
        });
      }
    } catch {
      // Modo offline o sin backend activo: mantiene estado en memoria
    }
  }, [idChoferActual]);

  // Cada oferta pendiente abre una ventana emergente únicamente cuando el chofer está conectado/disponible.
  useEffect(() => {
    if (!disponible) {
      setIdOfertaEmergente(null);
      return;
    }
    const pendientes = ofertas.filter(
      (oferta) => oferta.estado === "pendiente" && calcularSegundosRestantes(oferta.expira_en) > 0
    );
    setIdOfertaEmergente((actual) =>
      actual && pendientes.some((oferta) => oferta.id_oferta === actual)
        ? actual
        : pendientes[0]?.id_oferta ?? null
    );
  }, [ofertas, disponible]);

  useEffect(() => {
    void sincronizarEstadoServidor();
  }, [sincronizarEstadoServidor]);

  // Reloj de 1s para actualizar cuentas regresivas de 60s y marcar vencimientos locales exactos
  useEffect(() => {
    const intervalo = setInterval(() => {
      const instante = Date.now();
      setAhoraMs(instante);
      setOfertas((previas) => {
        let cambio = false;
        const actualizadas = previas.map((oferta) => {
          if (oferta.estado === "pendiente" && Date.parse(oferta.expira_en) <= instante) {
            cambio = true;
            return { ...oferta, estado: "vencida" as const, motivo: "vigencia_vencida" };
          }
          return oferta;
        });
        return cambio ? actualizadas : previas;
      });
    }, 1000);
    return () => clearInterval(intervalo);
  }, []);

  // Suscripción a eventos WebSocket y reconexión
  useEffect(() => {
    clienteTiempoReal.conectar();
    const desuscribirEstado = clienteTiempoReal.alCambiarEstado(setEstadoWs);
    const desuscribirReconexion = clienteTiempoReal.alReconectar(() => {
      void sincronizarEstadoServidor();
    });

    const desuscribirTodos = clienteTiempoReal.on("*", (mensajeRaw) => {
      const raw = mensajeRaw as unknown as {
        tipo?: string;
        evento?: string;
        datos?: Record<string, unknown>;
      };
      const nombreEvento = raw.tipo ?? raw.evento ?? "";
      const datos = raw.datos ?? {};

      if (nombreEvento === "OFERTA_NUEVA") {
        if (!disponibleRef.current) return;
        const idOferta = String(datos.id_oferta ?? datos.id ?? `of-${Date.now()}`);
        const idViaje = String(datos.id_viaje ?? datos.idViaje ?? "viaje-ws");
        const enviadaEn = String(datos.enviada_en ?? new Date().toISOString());
        const expiraEn = String(datos.expira_en ?? datos.expiraEn ?? new Date(Date.now() + 60_000).toISOString());

        const nuevaOferta: OfertaDto = {
          id_oferta: idOferta,
          id_viaje: idViaje,
          id_chofer: idChoferActual,
          estado: "pendiente",
          enviada_en: enviadaEn,
          expira_en: expiraEn,
          origen: datos.origen as CoordenadaChofer | undefined,
          destino: datos.destino as CoordenadaChofer | undefined,
          precio_estimado: datos.precio_estimado === undefined ? undefined : String(datos.precio_estimado),
          moneda: typeof datos.moneda === "string" ? datos.moneda : undefined,
        };

        setOfertas((prev) => {
          const sinDuplicado = prev.filter((item) => item.id_oferta !== idOferta);
          return [nuevaOferta, ...sinDuplicado];
        });

        // Restaura la versión canónica de la oferta por el endpoint destinado al chofer.
        // El chofer candidato aún no es participante y no debe consultar el viaje directamente.
        void sincronizarEstadoServidor();
      }

      if (nombreEvento === "OFERTA_VENCIDA" || nombreEvento === "OFERTA_CANCELADA") {
        const idOferta = String(datos.id_oferta ?? datos.id ?? "");
        const nuevoEstado = nombreEvento === "OFERTA_VENCIDA" ? "vencida" : "cancelada";
        const motivo = String(datos.motivo ?? (nombreEvento === "OFERTA_VENCIDA" ? "vigencia_vencida" : "viaje_asignado"));
        setOfertas((prev) =>
          prev.map((item) =>
            item.id_oferta === idOferta
              ? { ...item, estado: motivo === "viaje_asignado" ? "no_seleccionada" : nuevoEstado, motivo }
              : item
          )
        );
      }

      if (nombreEvento === "ESTADO_VIAJE_ACTUALIZADO" || nombreEvento === "VIAJE_ACTUALIZADO") {
        const idViaje = String(datos.id_viaje ?? datos.id ?? "");
        const nuevoEstado = String(datos.estado ?? "").toLowerCase();
        setViajesChofer((prev) =>
          prev.map((viaje) =>
            viaje.id_viaje === idViaje
              ? {
                  ...viaje,
                  estado: nuevoEstado,
                  ...(nuevoEstado === "finalizado" ? { finalizado_en: String(datos.actualizado_en ?? new Date().toISOString()) } : {}),
                }
              : viaje
          )
        );
        setViajeActivo((prev) => {
          if (!prev || prev.id_viaje !== idViaje) return prev;
          if (ESTADOS_HISTORIAL_CHOFER.has(nuevoEstado)) return null;
          return { ...prev, estado: nuevoEstado };
        });
        if (ESTADOS_HISTORIAL_CHOFER.has(nuevoEstado)) void sincronizarEstadoServidor();
      }
    });

    return () => {
      desuscribirEstado();
      desuscribirReconexion();
      desuscribirTodos();
    };
  }, [idChoferActual, sincronizarEstadoServidor]);

  // 1. Cambiar Disponibilidad en ms-flota (PATCH /choferes/yo/disponibilidad)
  const alternarDisponibilidad = async () => {
    const nuevoEstado = !disponible;
    setCargandoDisponibilidad(true);
    setAlertaError(null);
    setMensajeExito(null);

    try {
      const respuesta = await clienteApi.patch<{ disponibilidad: boolean }>("/choferes/yo/disponibilidad", {
        disponibilidad: nuevoEstado,
      });
      const estaDisponible = Boolean(respuesta.disponibilidad);
      disponibleRef.current = estaDisponible;
      setDisponible(estaDisponible);
      setMensajeExito(
        estaDisponible
          ? "Conectado. Ya estás disponible para recibir solicitudes."
          : "Desconectado. No recibirás nuevas ofertas hasta volver a iniciar."
      );
      if (estaDisponible) {
        void sincronizarEstadoServidor();
      } else {
        setIdOfertaEmergente(null);
      }
    } catch (err) {
      if (err instanceof ErrorHttpApi) {
        if (err.status === 0 && modoDev) {
          // Modo demo sin backend levantado: reflejar cambio local
          setDisponible(nuevoEstado);
          setMensajeExito(
            nuevoEstado
              ? "Disponibilidad activada (modo demostración local)."
              : "Disponibilidad desactivada (modo demostración local)."
          );
        } else {
          setAlertaError({ codigo: err.codigo, mensaje: err.mensaje, esConflicto409: err.status === 409 });
        }
      } else {
        setAlertaError({ codigo: "ERROR_DISPONIBILIDAD", mensaje: "No se pudo cambiar la disponibilidad." });
      }
    } finally {
      setCargandoDisponibilidad(false);
    }
  };

  // 2. Enviar ubicación manual o de paso simulado a ms-flota (POST /choferes/yo/ubicacion)
  const reportarUbicacion = useCallback(
    async (lat: number, lon: number, etiqueta?: string) => {
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        setAlertaError({
          codigo: "COORDENADAS_INVALIDAS",
          mensaje: "La latitud debe estar entre -90 y 90 y la longitud entre -180 y 180.",
        });
        return;
      }

      setEnviandoUbicacion(true);
      setAlertaError(null);
      const ahoraIso = new Date().toISOString();

      try {
        const resp = await clienteApi.post<{
          latitud: number;
          longitud: number;
          actualizado_at: string;
        }>("/choferes/yo/ubicacion", {
          latitud: lat,
          longitud: lon,
          actualizado_at: ahoraIso,
          precision_metros: 8,
        });

        setUltimaUbicacion({
          latitud: resp.latitud,
          longitud: resp.longitud,
          actualizado_at: resp.actualizado_at,
          etiqueta,
        });
        setLatitudInput(String(resp.latitud));
        setLongitudInput(String(resp.longitud));
      } catch (err) {
        if (err instanceof ErrorHttpApi && err.status === 0 && modoDev) {
          setUltimaUbicacion({
            latitud: lat,
            longitud: lon,
            actualizado_at: ahoraIso,
            etiqueta,
          });
          setLatitudInput(String(lat));
          setLongitudInput(String(lon));
        } else if (err instanceof ErrorHttpApi) {
          setAlertaError({ codigo: err.codigo, mensaje: err.mensaje, esConflicto409: err.status === 409 });
        } else {
          setAlertaError({ codigo: "ERROR_UBICACION", mensaje: "No se pudo registrar la ubicación." });
        }
      } finally {
        setEnviandoUbicacion(false);
      }
    },
    [modoDev]
  );

  const solicitarSugerenciasDireccion = useCallback((consulta: string) => {
    if (debounceDireccionRef.current !== null) {
      window.clearTimeout(debounceDireccionRef.current);
      debounceDireccionRef.current = null;
    }
    const limpia = consulta.trim();
    if (limpia.length < 3) {
      secuenciaDireccionRef.current += 1;
      setSugerenciasDireccion([]);
      setBuscandoDireccion(false);
      return;
    }
    const turno = secuenciaDireccionRef.current + 1;
    secuenciaDireccionRef.current = turno;
    setBuscandoDireccion(true);
    debounceDireccionRef.current = window.setTimeout(() => {
      void clienteApi
        .post<{ sugerencias: Array<{ etiqueta: string; latitud: number; longitud: number }> }>(
          "/tarifas/autocompletar",
          { consulta: limpia, centro: { latitud: -27.4512, longitud: -58.9866 } }
        )
        .then((res) => {
          if (secuenciaDireccionRef.current !== turno) return;
          setSugerenciasDireccion(Array.isArray(res.sugerencias) ? res.sugerencias : []);
        })
        .catch(() => {
          if (secuenciaDireccionRef.current !== turno) return;
          setSugerenciasDireccion([]);
        })
        .finally(() => {
          if (secuenciaDireccionRef.current === turno) setBuscandoDireccion(false);
        });
    }, 250);
  }, []);

  const seleccionarSugerenciaDireccion = async (sugerencia: {
    etiqueta: string;
    latitud: number;
    longitud: number;
  }) => {
    setDireccionInput(sugerencia.etiqueta);
    setSugerenciasDireccion([]);
    setLatitudInput(String(sugerencia.latitud));
    setLongitudInput(String(sugerencia.longitud));
    await reportarUbicacion(sugerencia.latitud, sugerencia.longitud, sugerencia.etiqueta);
  };

  const manejarEnvioUbicacionManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const consulta = direccionInput.trim();
    if (consulta.length >= 3) {
      setEnviandoUbicacion(true);
      setAlertaError(null);
      try {
        const res = await clienteApi.post<{
          sugerencias: Array<{ etiqueta: string; latitud: number; longitud: number }>;
        }>("/tarifas/autocompletar", {
          consulta,
          centro: { latitud: -27.4512, longitud: -58.9866 },
        });
        const primera = res.sugerencias?.[0];
        if (!primera) {
          setAlertaError({
            codigo: "DIRECCION_NO_ENCONTRADA",
            mensaje: "No encontramos esa dirección. Probá agregando calle, altura o barrio en Resistencia.",
          });
          setEnviandoUbicacion(false);
          return;
        }
        setDireccionInput(primera.etiqueta);
        setSugerenciasDireccion([]);
        await reportarUbicacion(primera.latitud, primera.longitud, primera.etiqueta);
        return;
      } catch (err) {
        setEnviandoUbicacion(false);
        if (err instanceof ErrorHttpApi) {
          setAlertaError({ codigo: err.codigo, mensaje: err.mensaje, esConflicto409: err.status === 409 });
        } else {
          setAlertaError({ codigo: "ERROR_UBICACION", mensaje: "No se pudo resolver la dirección ingresada." });
        }
        return;
      }
    }
    await reportarUbicacion(Number(latitudInput), Number(longitudInput), "Posición manual");
  };

  // Envío automático de ubicación cada 2 segundos mientras el chofer está conectado o en viaje
  useEffect(() => {
    if (!disponible && !tieneViajeEnCurso) return;

    const enviarUbicacionPeriodica = async () => {
      if (!latitudRef.current.trim() || !longitudRef.current.trim()) return;
      const lat = Number(latitudRef.current);
      const lon = Number(longitudRef.current);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        return;
      }
      const ahoraIso = new Date().toISOString();
      try {
        const resp = await clienteApi.post<{
          latitud: number;
          longitud: number;
          actualizado_at: string;
        }>("/choferes/yo/ubicacion", {
          latitud: lat,
          longitud: lon,
          actualizado_at: ahoraIso,
          precision_metros: 8,
        });
        setUltimaUbicacion({
          latitud: resp.latitud,
          longitud: resp.longitud,
          actualizado_at: resp.actualizado_at,
          etiqueta: "Actualización automática (2s)",
        });
      } catch {
        // Silencioso en pings periódicos para no interrumpir la UI
      }
    };

    void enviarUbicacionPeriodica();
    const timer = setInterval(() => {
      void enviarUbicacionPeriodica();
    }, 2000);
    return () => clearInterval(timer);
  }, [disponible, tieneViajeEnCurso]);

  useEffect(() => {
    if (modoDev) return;
    setOfertas((prev) => prev.filter((oferta) => !oferta.id_oferta.startsWith("oferta-demo-")));
    setViajeActivo((prev) => prev?.id_viaje.startsWith("viaje-demo-") ? null : prev);
    setViajesChofer((prev) => prev.filter((viaje) => !viaje.id_viaje.startsWith("viaje-demo-")));
    setUltimoCobro((prev) => prev?.id_cobro.startsWith("cobro-demo-") ? null : prev);
  }, [modoDev]);

  // Simular recepción de oferta de 60s para demostración / pruebas de UI
  const simularOfertaEntrante = () => {
    setAlertaError(null);
    const ahora = new Date();
    const expira = new Date(ahora.getTime() + 60_000);
    const idSim = `oferta-demo-${Math.floor(1000 + Math.random() * 9000)}`;
    const nueva: OfertaDto = {
      id_oferta: idSim,
      id_viaje: `viaje-demo-${Math.floor(100 + Math.random() * 900)}`,
      id_chofer: idChoferActual,
      estado: "pendiente",
      enviada_en: ahora.toISOString(),
      expira_en: expira.toISOString(),
      origen: { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo, Resistencia" },
      destino: { latitud: -27.4598, longitud: -58.9789, direccion: "UNNE Campus Resistencia" },
      precio_estimado: "4250",
      moneda: "ARS",
    };
    setOfertas((prev) => [nueva, ...prev]);
  };

  // 3. Aceptar oferta (POST /choferes/yo/ofertas/:idOferta/aceptacion) y manejo de 409
  const aceptarOferta = async (oferta: OfertaDto) => {
    if (tieneViajeEnCurso) {
      setAlertaError({
        codigo: "ASIGNACION_EN_CONFLICTO",
        mensaje: "Ya tenés un viaje activo asignado. Finalizalo antes de aceptar otra oferta.",
        esConflicto409: true,
      });
      return;
    }

    setProcesandoOfertaId(oferta.id_oferta);
    setAlertaError(null);
    setMensajeExito(null);
    setUltimoCobro(null);

    try {
      const viajeAsignado = await clienteApi.post<ViajeChoferDto>(
        `/choferes/yo/ofertas/${encodeURIComponent(oferta.id_oferta)}/aceptacion`,
        {}
      );
      guardarViajeEnLista(viajeAsignado);
      setViajeCerradoReciente(null);
      setViajeActivo(viajeAsignado);
      setOfertas((prev) =>
        prev.map((item) =>
          item.id_oferta === oferta.id_oferta
            ? { ...item, estado: "aceptada", respondida_en: new Date().toISOString() }
            : item.id_viaje === oferta.id_viaje && item.estado === "pendiente"
              ? { ...item, estado: "no_seleccionada", motivo: "viaje_asignado" }
              : item
        )
      );
      setMensajeExito(`Oferta ${oferta.id_oferta} aceptada. Viaje asignado correctamente.`);
    } catch (err) {
      if (err instanceof ErrorHttpApi) {
        if (err.status === 0 && modoDev) {
          // Fallback local para demostración sin servidor
          const simulado: ViajeChoferDto = {
            id_viaje: oferta.id_viaje,
            pasajero_id: "pasajero-demo-1",
            chofer_id: idChoferActual,
            origen: oferta.origen ?? { latitud: -27.4512, longitud: -58.9866, direccion: "Plaza 25 de Mayo" },
            destino: oferta.destino ?? { latitud: -27.4598, longitud: -58.9789, direccion: "UNNE Campus Resistencia" },
            id_estimacion: "est-demo",
            precio_estimado: oferta.precio_estimado ?? "4250",
            precio_final: null,
            moneda: "ARS",
            multiplicador_demanda: 1,
            factores_precio: {},
            estado: "asignado",
            creado_en: new Date().toISOString(),
          };
          guardarViajeEnLista(simulado);
          setViajeCerradoReciente(null);
          setViajeActivo(simulado);
          setOfertas((prev) =>
            prev.map((item) => (item.id_oferta === oferta.id_oferta ? { ...item, estado: "aceptada" } : item))
          );
          setMensajeExito(`Oferta ${oferta.id_oferta} aceptada (modo demostración).`);
        } else if (err.status === 409) {
          // Carrera concurrente (otro chofer la tomó primero) u oferta vencida
          const esVencida = err.codigo === "OFERTA_VENCIDA";
          setOfertas((prev) =>
            prev.map((item) =>
              item.id_oferta === oferta.id_oferta
                ? {
                    ...item,
                    estado: esVencida ? "vencida" : "no_seleccionada",
                    motivo: esVencida ? "vigencia_vencida" : "viaje_asignado",
                  }
                : item
            )
          );
          setAlertaError({
            codigo: err.codigo || "ASIGNACION_EN_CONFLICTO",
            mensaje:
              err.codigo === "OFERTA_VENCIDA"
                ? "La oferta venció antes de que pudieras responder."
                : "Otro chofer aceptó esta oferta o ya no está disponible.",
            esConflicto409: true,
          });
        } else {
          setAlertaError({ codigo: err.codigo, mensaje: err.mensaje });
        }
      } else {
        setAlertaError({ codigo: "ERROR_ACEPTACION", mensaje: "No se pudo aceptar la oferta." });
      }
    } finally {
      setProcesandoOfertaId(null);
    }
  };

  // 4. Rechazar oferta (POST /choferes/yo/ofertas/:idOferta/rechazo)
  const rechazarOferta = async (oferta: OfertaDto) => {
    setProcesandoOfertaId(oferta.id_oferta);
    setAlertaError(null);

    try {
      await clienteApi.post(`/choferes/yo/ofertas/${encodeURIComponent(oferta.id_oferta)}/rechazo`, {});
      setOfertas((prev) =>
        prev.map((item) =>
          item.id_oferta === oferta.id_oferta
            ? { ...item, estado: "rechazada", respondida_en: new Date().toISOString() }
            : item
        )
      );
    } catch (err) {
      if (err instanceof ErrorHttpApi && err.status === 0 && modoDev) {
        setOfertas((prev) =>
          prev.map((item) => (item.id_oferta === oferta.id_oferta ? { ...item, estado: "rechazada" } : item))
        );
      } else if (err instanceof ErrorHttpApi) {
        setAlertaError({ codigo: err.codigo, mensaje: err.mensaje, esConflicto409: err.status === 409 });
      }
    } finally {
      setProcesandoOfertaId(null);
    }
  };

  // 5. Avanzar estados del viaje (llegada -> chofer_en_camino, inicio -> en_curso, finalizacion -> finalizado)
  const marcarChoferEnCamino = async () => {
    if (!viajeActivo || viajeActivo.estado.toLowerCase() !== "asignado") return;
    setProcesandoTransicion(true);
    setAlertaError(null);

    try {
      const actualizado = await clienteApi.post<ViajeChoferDto>(
        `/viajes/${encodeURIComponent(viajeActivo.id_viaje)}/llegada`,
        {}
      );
      guardarViajeEnLista(actualizado);
      setViajeActivo(actualizado);
      setMensajeExito("Estado actualizado: Chofer en camino al punto de encuentro.");
    } catch (err) {
      if (err instanceof ErrorHttpApi && err.status === 0 && modoDev) {
        const simulado = { ...viajeActivo, estado: "chofer_en_camino" };
        guardarViajeEnLista(simulado);
        setViajeActivo(simulado);
      } else if (err instanceof ErrorHttpApi) {
        setAlertaError({ codigo: err.codigo, mensaje: err.mensaje, esConflicto409: err.status === 409 });
      }
    } finally {
      setProcesandoTransicion(false);
    }
  };

  const iniciarViajeEnCurso = async () => {
    if (!viajeActivo || viajeActivo.estado.toLowerCase() !== "chofer_en_camino") return;
    setProcesandoTransicion(true);
    setAlertaError(null);

    try {
      const actualizado = await clienteApi.post<ViajeChoferDto>(
        `/viajes/${encodeURIComponent(viajeActivo.id_viaje)}/inicio`,
        {}
      );
      guardarViajeEnLista(actualizado);
      setViajeActivo(actualizado);
      setMensajeExito("Viaje en curso con el pasajero a bordo.");
    } catch (err) {
      if (err instanceof ErrorHttpApi && err.status === 0 && modoDev) {
        const simulado = { ...viajeActivo, estado: "en_curso", iniciado_en: new Date().toISOString() };
        guardarViajeEnLista(simulado);
        setViajeActivo(simulado);
      } else if (err instanceof ErrorHttpApi) {
        setAlertaError({ codigo: err.codigo, mensaje: err.mensaje, esConflicto409: err.status === 409 });
      }
    } finally {
      setProcesandoTransicion(false);
    }
  };

  const finalizarYCobrarViaje = async () => {
    if (!viajeActivo || viajeActivo.estado.toLowerCase() !== "en_curso") return;
    setProcesandoTransicion(true);
    setAlertaError(null);
    setMensajeExito(null);
    setResultadoFinalizacion(null);

    try {
      const resultado = await clienteApi.post<{ viaje: ViajeChoferDto; cobro: CobroChoferDto }>(
        `/viajes/${encodeURIComponent(viajeActivo.id_viaje)}/finalizacion`,
        {}
      );
      guardarViajeEnLista(resultado.viaje);
      setViajeCerradoReciente(resultado.viaje);
      setViajeActivo(null);
      setUltimoCobro(resultado.cobro);
      setResultadoFinalizacion({
        tipo: "exito",
        mensaje: resultado.cobro.estado === "confirmado"
          ? `Viaje finalizado. Cobro confirmado por ${formatearImporteArs(resultado.cobro.importe)}.`
          : `Viaje finalizado. El cobro quedó ${resultado.cobro.estado} por ${formatearImporteArs(resultado.cobro.importe)}.`
      });
    } catch (err) {
      // El backend puede haber guardado FINALIZADO y fallar después al crear el recibo.
      // Refrescar el estado canónico evita dejar el panel mostrando un viaje activo falso.
      await sincronizarEstadoServidor();
      const detalle = err instanceof ErrorHttpApi
        ? err.mensaje
        : "No se recibió una respuesta válida del servidor.";
      setResultadoFinalizacion({
        tipo: "error",
        mensaje: `${detalle} Actualicé el estado del viaje; revisá el historial y usá “Ver o completar recibo” si ya figura como finalizado.`
      });
    } finally {
      setProcesandoTransicion(false);
    }
  };

  const consultarOCCompletarCobro = async (viaje: ViajeChoferDto) => {
    setViajeConsultandoCobro(viaje.id_viaje);
    setResultadoCobroHistorial(null);
    try {
      // La finalización es idempotente: devuelve el recibo existente o recupera uno
      // que no se pudo crear después de que el viaje quedó FINALIZADO.
      const resultado = await clienteApi.post<{ viaje: ViajeChoferDto; cobro: CobroChoferDto }>(
        `/viajes/${encodeURIComponent(viaje.id_viaje)}/finalizacion`,
        {}
      );
      guardarViajeEnLista(resultado.viaje);
      setUltimoCobro(resultado.cobro);
      setResultadoCobroHistorial({
        idViaje: viaje.id_viaje,
        tipo: "exito",
        mensaje: `Recibo disponible por ${formatearImporteArs(resultado.cobro.importe)}. Estado del cobro: ${resultado.cobro.estado}.`
      });
    } catch (err) {
      const detalle = err instanceof ErrorHttpApi
        ? err.mensaje
        : "No se pudo consultar o completar el recibo.";
      setResultadoCobroHistorial({ idViaje: viaje.id_viaje, tipo: "error", mensaje: detalle });
    } finally {
      setViajeConsultandoCobro(null);
    }
  };

  const estadoNormalizado = viajeActivo?.estado.toLowerCase() ?? "";
  const puedeMarcarEnCamino = estadoNormalizado === "asignado" && !procesandoTransicion;
  const puedeIniciarViaje = estadoNormalizado === "chofer_en_camino" && !procesandoTransicion;
  const puedeFinalizarViaje = estadoNormalizado === "en_curso" && !procesandoTransicion;
  const ofertasPendientes = disponible
    ? ofertas.filter(
        (oferta) => oferta.estado === "pendiente" && calcularSegundosRestantes(oferta.expira_en, ahoraMs) > 0
      )
    : [];
  const ofertaEmergente = ofertas.find((oferta) => oferta.id_oferta === idOfertaEmergente && oferta.estado === "pendiente");
  const historialViajes = viajesChofer
    .filter((viaje) => viaje.chofer_id === idChoferActual && ESTADOS_HISTORIAL_CHOFER.has(viaje.estado.toLowerCase()))
    .sort((a, b) => Date.parse(b.finalizado_en ?? b.cancelado_en ?? b.creado_en) - Date.parse(a.finalizado_en ?? a.cancelado_en ?? a.creado_en));
  const estadoVisibleViaje = viajeActivo?.estado ?? viajeCerradoReciente?.estado;
  const segundosOfertaEmergente = ofertaEmergente
    ? calcularSegundosRestantes(ofertaEmergente.expira_en, ahoraMs)
    : 0;
  const ofertaEmergenteBloqueada = Boolean(
    ofertaEmergente && tieneViajeEnCurso && viajeActivo?.id_viaje !== ofertaEmergente.id_viaje
  );
  const ofertaEmergenteConDetalles = Boolean(
    ofertaEmergente?.origen && ofertaEmergente.destino && ofertaEmergente.precio_estimado
  );

  return (
    <div className="space-y-6" data-testid="vista-chofer">
      {/* Encabezado y Toggle de Disponibilidad */}
      <div className="bg-[#EFECE4] dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-[#DDD8CC] dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-[#4A7C59] dark:text-emerald-400 uppercase tracking-wider">Panel de Chofer</span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#2C2B28] dark:text-slate-100 mt-0.5">
            Hola, {sesion?.nombre || "Chofer"}
          </h1>
          <p className="text-xs sm:text-sm text-[#5E5B54] dark:text-slate-400 mt-1">
            Activá tu disponibilidad para recibir solicitudes y respondé antes de que venza cada oferta.
          </p>
        </div>

        {/* Toggle de Disponibilidad */}
        <div className="flex items-center justify-between sm:justify-end gap-3 bg-[#F7F5F0] dark:bg-slate-800/70 p-2.5 rounded-xl border border-[#DDD8CC] dark:border-slate-700">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-[#2C2B28] dark:text-slate-200">Disponibilidad:</span>
            <span
              id="estado-disponibilidad-chofer"
              data-testid="estado-disponibilidad-chofer"
              className="text-[11px] text-[#5E5B54] dark:text-slate-400"
            >
              {disponible ? "En línea — Recibiendo ofertas" : "Desconectado — No recibís ofertas"}
            </span>
          </div>
          <button
            id="boton-toggle-disponibilidad"
            data-testid="boton-toggle-disponibilidad"
            type="button"
            disabled={cargandoDisponibilidad}
            aria-pressed={disponible}
            onClick={() => void alternarDisponibilidad()}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer ${
              disponible
                ? "bg-[#4A7C59] text-white hover:bg-[#3E6A4B]"
                : "bg-[#E5E0D4] dark:bg-slate-700 text-[#2C2B28] dark:text-slate-200 hover:bg-[#D7D1C2] dark:hover:bg-slate-600"
            }`}
          >
            {cargandoDisponibilidad
              ? "Actualizando..."
              : disponible
                ? "Conectado (Desconectarse)"
                : "Iniciar y conectarse"}
          </button>
        </div>
      </div>

      {/* Banners de Alerta (409 Conflict / Errores) y Confirmación */}
      {alertaError && (
        <div
          id="alerta-error-chofer"
          data-testid="alerta-error-chofer"
          role="alert"
          className={`p-4 rounded-xl border text-xs sm:text-sm flex items-start justify-between gap-3 ${
            alertaError.esConflicto409
              ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200"
              : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200"
          }`}
        >
          <div className="space-y-0.5">
            <div className="font-bold flex items-center gap-1.5">
              <IconoAlerta size={16} aria-hidden="true" />
              <span>{alertaError.esConflicto409 ? "La oferta ya no está disponible" : "No se pudo completar la acción"}</span>
              {modoDev && (
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-900/80 border border-current/20">
                  {alertaError.codigo}
                </span>
              )}
            </div>
            <p>{alertaError.mensaje}</p>
          </div>
          <button
            type="button"
            onClick={() => setAlertaError(null)}
            className="font-bold text-base leading-none px-1.5 py-0.5 rounded hover:bg-black/5 cursor-pointer"
            aria-label="Cerrar alerta"
          >
            &times;
          </button>
        </div>
      )}

      {mensajeExito && (
        <div
          id="mensaje-exito-chofer"
          data-testid="mensaje-exito-chofer"
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs sm:text-sm flex items-center justify-between gap-3"
        >
          <span className="inline-flex items-center gap-2"><IconoCheck size={16} aria-hidden="true" /> {mensajeExito}</span>
          <button
            type="button"
            onClick={() => setMensajeExito(null)}
            className="font-bold text-emerald-900 px-1.5 cursor-pointer"
            aria-label="Cerrar mensaje"
          >
            &times;
          </button>
        </div>
      )}

      <IndicadorConexionTiempoReal mostrarControlesSimulacion={modoDev} />

      {/* Grid Principal Responsive (360px 1 col -> 768px 2 cols -> 1024px+ 3 cols) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Columna 1: Bandeja de Ofertas en Tiempo Real */}
        <div className="md:col-span-1 space-y-4">
          <div className="bg-[#EFECE4] dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-[#DDD8CC] dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#2C2B28] dark:text-slate-100 uppercase tracking-wide flex items-center gap-2">
                <IconoRayo size={16} aria-hidden="true" /> Ofertas Recibidas
              </h2>
              <span
                data-testid="indicador-ws-chofer"
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  estadoWs === "CONECTADO"
                    ? "bg-[#E6EFE8] dark:bg-emerald-950/60 text-[#3B694A] dark:text-emerald-300 border-[#4A7C59]/30 dark:border-emerald-800"
                    : estadoWs === "CONECTANDO"
                      ? "bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                      : "bg-[#F7F5F0] dark:bg-slate-800 text-[#5E5B54] dark:text-slate-300 border-[#DDD8CC] dark:border-slate-700"
                }`}
              >
                {estadoWs === "CONECTADO" ? "En línea" : estadoWs === "CONECTANDO" ? "Reconectando…" : "Sin conexión"}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                id="boton-actualizar-ofertas"
                type="button"
                onClick={() => void sincronizarEstadoServidor()}
                className="px-2.5 py-1 rounded-lg border border-[#D4CFC2] dark:border-slate-700 hover:bg-[#E5E0D4] dark:hover:bg-slate-800 text-[11px] font-semibold text-[#5E5B54] dark:text-slate-300 transition cursor-pointer"
              >
                ↻ Actualizar ofertas
              </button>
              {modoDev && <button
                id="boton-simular-oferta"
                data-testid="boton-simular-oferta"
                type="button"
                onClick={simularOfertaEntrante}
                className="px-2.5 py-1 rounded-lg bg-[#4A7C59]/15 hover:bg-[#4A7C59]/25 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-[11px] font-semibold text-[#3B694A] dark:text-emerald-300 border border-[#4A7C59]/30 dark:border-emerald-800 transition cursor-pointer"
              >
                + Simular oferta (60s)
              </button>}
            </div>

            {!disponible && ofertasPendientes.length === 0 ? (
              <div
                data-testid="bandeja-ofertas-inactiva"
                className="p-6 rounded-xl bg-[#F7F5F0] dark:bg-slate-800/50 border border-dashed border-[#D4CFC2] dark:border-slate-700 text-center text-xs text-[#5E5B54] dark:text-slate-400"
              >
                Activá tu disponibilidad para comenzar a recibir ofertas de pasajeros cercanos.
              </div>
            ) : ofertasPendientes.length === 0 ? (
              <div
                data-testid="bandeja-ofertas-vacia"
                className="p-6 rounded-xl bg-[#E6EFE8] dark:bg-emerald-950/30 border border-dashed border-[#4A7C59]/30 dark:border-emerald-800 text-center text-xs text-[#3B694A] dark:text-emerald-300"
              >
                Estás disponible y en línea. Esperando nuevas solicitudes de viaje cercanas...
              </div>
            ) : (
              <div className="space-y-3" data-testid="lista-ofertas-chofer">
                {ofertasPendientes.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#4A7C59]/30 dark:border-emerald-800 bg-[#E6EFE8] dark:bg-emerald-950/30 p-3">
                    <span className="text-xs font-semibold text-[#3B694A] dark:text-emerald-300">
                      {ofertasPendientes.length === 1
                        ? "Tenés una oferta pendiente. Se abrió una ventana para responder."
                        : `Tenés ${ofertasPendientes.length} ofertas pendientes para responder.`}
                    </span>
                    <button
                      type="button"
                      data-testid="boton-ver-oferta-pendiente"
                      onClick={() => setIdOfertaEmergente(ofertasPendientes[0]?.id_oferta ?? null)}
                      className="rounded-lg bg-[#4A7C59] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3E6A4B] cursor-pointer"
                    >
                      Ver oferta
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Columna 2 y 3: Viaje Asignado, Controles de Transición y Reporte de Ubicación */}
        <div className="md:col-span-1 lg:col-span-2 space-y-6">
          {/* Tarjeta de Viaje Asignado y Máquina de Estados */}
          <div className="bg-[#EFECE4] dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-[#DDD8CC] dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#2C2B28] dark:text-slate-100 uppercase tracking-wide flex items-center gap-2">
                <IconoAuto size={16} aria-hidden="true" /> Viaje Asignado
              </h2>
              <span
                id="estado-viaje-chofer"
                data-testid="estado-viaje-chofer"
                className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                  tieneViajeEnCurso
                    ? "bg-[#E6EFE8] dark:bg-emerald-950/60 text-[#3B694A] dark:text-emerald-300 border-[#4A7C59]/30 dark:border-emerald-800"
                    : estadoVisibleViaje?.toLowerCase() === "finalizado"
                      ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
                      : "bg-[#F7F5F0] dark:bg-slate-800 text-[#5E5B54] dark:text-slate-300 border-[#DDD8CC] dark:border-slate-700"
                }`}
              >
                {etiquetaEstadoViaje(estadoVisibleViaje)}
              </span>
            </div>

            {viajeActivo ? (
              <>
                <div
                  data-testid="detalle-viaje-asignado"
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"
                >
                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-semibold block">Precio Congelado</span>
                  <span className="font-extrabold text-emerald-700 dark:text-emerald-400 text-sm">
                    {formatearImporteArs(viajeActivo.precio_final ?? viajeActivo.precio_estimado)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-semibold block">Origen</span>
                  <span className="text-slate-800 dark:text-slate-200">
                    {viajeActivo.origen.direccion ??
                      `${viajeActivo.origen.latitud.toFixed(4)}, ${viajeActivo.origen.longitud.toFixed(4)}`}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-semibold block">Destino</span>
                  <span className="text-slate-800 dark:text-slate-200">
                    {viajeActivo.destino.direccion ??
                      `${viajeActivo.destino.latitud.toFixed(4)}, ${viajeActivo.destino.longitud.toFixed(4)}`}
                  </span>
                </div>
              </div>

              {/* Seguimiento en vivo por WebSocket con mapa y reconexión canónica */}
              <div className="pt-2">
                <SeguimientoMapaEnVivo
                  idViaje={viajeActivo.id_viaje}
                  viajeInicial={{
                    id_viaje: viajeActivo.id_viaje,
                    estado: viajeActivo.estado,
                    origen: viajeActivo.origen,
                    destino: viajeActivo.destino,
                    precio_estimado: viajeActivo.precio_estimado,
                    precio_final: viajeActivo.precio_final,
                    moneda: viajeActivo.moneda,
                  }}
                  onCambioEstado={(nuevo) => {
                    setViajeActivo((prev) => (prev ? { ...prev, estado: nuevo } : prev));
                  }}
                />
              </div>
            </>
            ) : (
              <div className="p-5 rounded-xl bg-[#F7F5F0] dark:bg-slate-800/50 border border-dashed border-[#D4CFC2] dark:border-slate-700 text-center text-xs text-[#5E5B54] dark:text-slate-400">
                No tenés un viaje activo en este momento. Cuando llegue una solicitud, vas a poder responder desde su ventana emergente.
              </div>
            )}

            {/* Resumen de Cobro cuando finaliza */}
            {ultimoCobro && (
              <div
                id="resumen-cobro-chofer"
                data-testid="resumen-cobro-chofer"
                className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${ultimoCobro.estado === "confirmado" ? "bg-[#E6EFE8] dark:bg-emerald-950/40 border-[#4A7C59]/30 dark:border-emerald-800 text-[#2C2B28] dark:text-emerald-200" : ultimoCobro.estado === "fallido" ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-950 dark:text-rose-200" : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-200"}`}
              >
                <div>
                  <span className={`font-bold uppercase tracking-wider text-[10px] block ${ultimoCobro.estado === "confirmado" ? "text-[#3B694A] dark:text-emerald-300" : ultimoCobro.estado === "fallido" ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300"}`}>
                    Recibo de Cobro Generado
                  </span>
                  <span className="font-semibold">
                    Cobro #{ultimoCobro.id_cobro} — Estado: {ultimoCobro.estado.toUpperCase()}
                  </span>
                </div>
                <span className={`text-base font-extrabold ${ultimoCobro.estado === "confirmado" ? "text-[#3B694A] dark:text-emerald-300" : ultimoCobro.estado === "fallido" ? "text-rose-800 dark:text-rose-300" : "text-amber-800 dark:text-amber-300"}`}>
                  {formatearImporteArs(ultimoCobro.importe)}
                </span>
              </div>
            )}

            {/* Botonera de Avance de Estados (Solo habilita la transición válida) */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                id="boton-chofer-en-camino"
                data-testid="boton-chofer-en-camino"
                type="button"
                disabled={!puedeMarcarEnCamino}
                onClick={() => void marcarChoferEnCamino()}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${
                  puedeMarcarEnCamino
                    ? "bg-[#4A7C59] hover:bg-[#3E6A4B] text-white border-[#4A7C59] cursor-pointer shadow-xs"
                    : "bg-[#E5E0D4] dark:bg-slate-800 text-[#7A776F] dark:text-slate-500 border-[#D4CFC2] dark:border-slate-700 cursor-not-allowed"
                }`}
              >
                1. Chofer en Camino
              </button>
              <button
                id="boton-iniciar-viaje"
                data-testid="boton-iniciar-viaje"
                type="button"
                disabled={!puedeIniciarViaje}
                onClick={() => void iniciarViajeEnCurso()}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${
                  puedeIniciarViaje
                    ? "bg-[#4A7C59] hover:bg-[#3E6A4B] text-white border-[#4A7C59] cursor-pointer shadow-xs"
                    : "bg-[#E5E0D4] dark:bg-slate-800 text-[#7A776F] dark:text-slate-500 border-[#D4CFC2] dark:border-slate-700 cursor-not-allowed"
                }`}
              >
                2. Iniciar Viaje
              </button>
              <button
                id="boton-finalizar-viaje"
                data-testid="boton-finalizar-viaje"
                type="button"
                disabled={!puedeFinalizarViaje}
                onClick={() => void finalizarYCobrarViaje()}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${
                  puedeFinalizarViaje
                    ? "bg-[#4A7C59] hover:bg-[#3E6A4B] text-white border-[#4A7C59] cursor-pointer shadow-xs"
                    : "bg-[#E5E0D4] dark:bg-slate-800 text-[#7A776F] dark:text-slate-500 border-[#D4CFC2] dark:border-slate-700 cursor-not-allowed"
                }`}
              >
                {procesandoTransicion ? "Finalizando..." : "3. Finalizar y confirmar pago"}
              </button>
            </div>
            {resultadoFinalizacion && (
              <p
                id="resultado-finalizacion-chofer"
                data-testid="resultado-finalizacion-chofer"
                role={resultadoFinalizacion.tipo === "error" ? "alert" : "status"}
                aria-live={resultadoFinalizacion.tipo === "error" ? "assertive" : "polite"}
                className={`rounded-lg border p-3 text-xs ${resultadoFinalizacion.tipo === "error"
                  ? "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200"
                  : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"}`}
              >
                {resultadoFinalizacion.mensaje}
              </p>
            )}
            {viajeActivo && !procesandoTransicion && estadoNormalizado !== "en_curso" && (
              <p className="text-right text-[11px] text-[#5E5B54] dark:text-slate-400" role="note">
                {estadoNormalizado === "asignado"
                  ? "Primero marcá que vas en camino; después iniciá el viaje para habilitar la finalización."
                  : "Iniciá el viaje para habilitar el botón “Finalizar y Cobrar”."}
              </p>
            )}
          </div>

          {/* Reporte de ubicación y controles de simulación */}
          <div className="bg-[#EFECE4] dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-[#DDD8CC] dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#2C2B28] dark:text-slate-100 uppercase tracking-wide flex items-center gap-2">
                  <IconoPin size={16} aria-hidden="true" /> Mi ubicación
                </h2>
                <p className="text-xs text-[#5E5B54] dark:text-slate-400 mt-0.5">
                  Mantené tu posición actualizada para recibir solicitudes cercanas.
                </p>
              </div>
            </div>

            {/* Formulario de ubicación por dirección (se resuelve automáticamente a coordenadas) */}
            <form onSubmit={(e) => void manejarEnvioUbicacionManual(e)} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div className="sm:col-span-2 relative">
                  <label htmlFor="input-direccion-chofer" className="block text-[11px] font-semibold text-[#5E5B54] dark:text-slate-300 mb-1">
                    Dirección actual
                  </label>
                  <input
                    id="input-direccion-chofer"
                    data-testid="input-direccion-chofer"
                    type="text"
                    placeholder="Ej: Av. Alberdi 250, Resistencia"
                    value={direccionInput}
                    onChange={(e) => {
                      const valor = e.target.value;
                      setDireccionInput(valor);
                      solicitarSugerenciasDireccion(valor);
                    }}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#D4CFC2] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800 text-[#2C2B28] dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-[#4A7C59]"
                  />
                  {buscandoDireccion && (
                    <span className="absolute right-3 top-7 text-[10px] text-[#5E5B54] dark:text-slate-400">
                      Buscando…
                    </span>
                  )}
                  {sugerenciasDireccion.length > 0 && (
                    <ul
                      data-testid="sugerencias-direccion-chofer"
                      className="absolute z-30 mt-1 w-full rounded-xl border border-[#D4CFC2] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-900 shadow-lg max-h-48 overflow-auto divide-y divide-[#E5E0D4] dark:divide-slate-800"
                    >
                      {sugerenciasDireccion.map((sug) => (
                        <li key={`${sug.etiqueta}-${sug.latitud}-${sug.longitud}`}>
                          <button
                            type="button"
                            onClick={() => void seleccionarSugerenciaDireccion(sug)}
                            className="w-full text-left px-3 py-2 text-xs text-[#2C2B28] dark:text-slate-100 hover:bg-[#E6EFE8] dark:hover:bg-slate-800 cursor-pointer"
                          >
                            {sug.etiqueta}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  id="boton-enviar-ubicacion"
                  data-testid="boton-enviar-ubicacion"
                  type="submit"
                  disabled={enviandoUbicacion}
                  className="w-full py-2 px-4 rounded-lg bg-[#4A7C59] hover:bg-[#3E6A4B] text-white text-xs font-bold transition cursor-pointer"
                >
                  {enviandoUbicacion ? "Enviando..." : "Enviar Ubicación"}
                </button>
              </div>

              {modoDev && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label htmlFor="input-latitud-chofer" className="block text-[11px] font-semibold text-[#5E5B54] dark:text-slate-300 mb-1">
                      Latitud (solo modo dev)
                    </label>
                    <input
                      id="input-latitud-chofer"
                      data-testid="input-latitud-chofer"
                      type="number"
                      step="0.0001"
                      value={latitudInput}
                      onChange={(e) => setLatitudInput(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[#D4CFC2] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800 text-[#2C2B28] dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-[#4A7C59]"
                    />
                  </div>
                  <div>
                    <label htmlFor="input-longitud-chofer" className="block text-[11px] font-semibold text-[#5E5B54] dark:text-slate-300 mb-1">
                      Longitud (solo modo dev)
                    </label>
                    <input
                      id="input-longitud-chofer"
                      data-testid="input-longitud-chofer"
                      type="number"
                      step="0.0001"
                      value={longitudInput}
                      onChange={(e) => setLongitudInput(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[#D4CFC2] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800 text-[#2C2B28] dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-[#4A7C59]"
                    />
                  </div>
                </div>
              )}
            </form>

            {/* Última posición confirmada */}
            <div
              id="ultima-ubicacion-chofer"
              data-testid="ultima-ubicacion-chofer"
              className="p-3 rounded-xl bg-[#F7F5F0] dark:bg-slate-800/70 border border-[#DDD8CC] dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#5E5B54] dark:text-slate-300"
            >
              {ultimaUbicacion ? (
                <>
                  <div>
                    <span className="font-semibold text-[#2C2B28] dark:text-slate-100">Última ubicación reportada: </span>
                    <span className="font-mono">
                      [{ultimaUbicacion.latitud.toFixed(4)}, {ultimaUbicacion.longitud.toFixed(4)}]
                    </span>
                    {ultimaUbicacion.etiqueta && (
                      <span className="ml-2 text-[#4A7C59] dark:text-emerald-400 font-semibold">— {ultimaUbicacion.etiqueta}</span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-[#5E5B54] dark:text-slate-400">
                    {new Date(ultimaUbicacion.actualizado_at).toLocaleTimeString("es-AR")}
                  </span>
                </>
              ) : (
                <span>Aún no se reportó ubicación en esta sesión.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <section
        aria-label="Historial de viajes del chofer"
        data-testid="historial-viajes-chofer"
        className="rounded-2xl border border-[#DDD8CC] dark:border-slate-800 bg-[#EFECE4] dark:bg-slate-900 shadow-xs"
      >
        <button
          type="button"
          data-testid="boton-toggle-historial-viajes"
          aria-expanded={mostrarHistorialViajes}
          aria-controls="lista-historial-viajes-chofer"
          onClick={() => setMostrarHistorialViajes((visible) => !visible)}
          className="flex w-full items-center justify-between gap-3 p-4 sm:p-5 text-left cursor-pointer"
        >
          <span className="text-sm font-bold uppercase tracking-wide text-[#2C2B28] dark:text-slate-100">
            Historial de viajes
          </span>
          <span className="flex items-center gap-2 text-xs font-semibold text-[#5E5B54] dark:text-slate-300">
            {historialViajes.length} viajes
            <span aria-hidden="true">{mostrarHistorialViajes ? "−" : "+"}</span>
          </span>
        </button>

        {mostrarHistorialViajes && (
          <div id="lista-historial-viajes-chofer" className="space-y-3 border-t border-[#DDD8CC] dark:border-slate-800 p-4 sm:p-5">
            {historialViajes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#D4CFC2] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800/60 p-5 text-center text-xs text-[#5E5B54] dark:text-slate-400">
                Todavía no hay viajes anteriores.
              </p>
            ) : (
              <ul className="space-y-3">
                {historialViajes.map((viaje) => {
                  const fecha = Date.parse(viaje.finalizado_en ?? viaje.cancelado_en ?? viaje.creado_en);
                  const fechaLegible = Number.isNaN(fecha)
                    ? "Fecha no disponible"
                    : new Date(fecha).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
                  return (
                    <li
                      key={viaje.id_viaje}
                      data-testid={`viaje-historial-${viaje.id_viaje}`}
                      className="grid grid-cols-1 gap-3 rounded-xl border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800/70 p-4 sm:grid-cols-2"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="rounded-md bg-[#E5E0D4] dark:bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-[#2C2B28] dark:text-slate-200">
                            {etiquetaEstadoViaje(viaje.estado)}
                          </span>
                        </div>
                        <p className="text-xs text-[#5E5B54] dark:text-slate-400">{fechaLegible}</p>
                      </div>
                      <div className="space-y-1 text-xs text-[#2C2B28] dark:text-slate-200">
                        <p><span className="font-semibold">Origen:</span> {viaje.origen.direccion ?? `${viaje.origen.latitud.toFixed(4)}, ${viaje.origen.longitud.toFixed(4)}`}</p>
                        <p><span className="font-semibold">Destino:</span> {viaje.destino.direccion ?? `${viaje.destino.latitud.toFixed(4)}, ${viaje.destino.longitud.toFixed(4)}`}</p>
                        <p className="pt-1 font-extrabold">Importe: {formatearImporteArs(viaje.precio_final ?? viaje.precio_estimado)}</p>
                      </div>
                      {viaje.estado.toLowerCase() === "finalizado" && (
                        <div className="sm:col-span-2 space-y-2">
                          <button
                            type="button"
                            data-testid={`boton-recibo-${viaje.id_viaje}`}
                            disabled={viajeConsultandoCobro === viaje.id_viaje}
                            onClick={() => void consultarOCCompletarCobro(viaje)}
                            className="rounded-lg border border-[#4A7C59]/40 dark:border-emerald-800 px-3 py-2 text-xs font-bold text-[#3B694A] dark:text-emerald-300 hover:bg-[#E6EFE8] dark:hover:bg-emerald-950/40 disabled:cursor-wait disabled:opacity-60"
                          >
                            {viajeConsultandoCobro === viaje.id_viaje ? "Consultando recibo..." : "Ver o completar recibo"}
                          </button>
                          {resultadoCobroHistorial?.idViaje === viaje.id_viaje && (
                            <p
                              role={resultadoCobroHistorial.tipo === "error" ? "alert" : "status"}
                              aria-live={resultadoCobroHistorial.tipo === "error" ? "assertive" : "polite"}
                              className={`rounded-lg border p-3 text-xs ${resultadoCobroHistorial.tipo === "error"
                                ? "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200"
                                : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"}`}
                            >
                              {resultadoCobroHistorial.mensaje}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {ofertaEmergente && (
        <Modal
          abierto
          titulo="Nueva oferta de viaje"
          onCerrar={() => setIdOfertaEmergente(null)}
          pie={(
            <>
              {ofertaEmergenteBloqueada && (
                <p className="basis-full text-xs text-amber-800 dark:text-amber-300">
                  Ya tenés otro viaje activo y no podés aceptar esta oferta.
                </p>
              )}
              <button
                type="button"
                data-testid={`boton-aceptar-${ofertaEmergente.id_oferta}`}
                disabled={
                  procesandoOfertaId === ofertaEmergente.id_oferta || ofertaEmergenteBloqueada ||
                  !ofertaEmergenteConDetalles || segundosOfertaEmergente <= 0
                }
                onClick={() => void aceptarOferta(ofertaEmergente)}
                className="min-w-28 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 cursor-pointer"
              >
                {procesandoOfertaId === ofertaEmergente.id_oferta
                  ? "Aceptando..."
                  : !ofertaEmergenteConDetalles
                    ? "Cargando detalles…"
                    : "Aceptar"}
              </button>
              <button
                type="button"
                data-testid={`boton-rechazar-${ofertaEmergente.id_oferta}`}
                disabled={procesandoOfertaId === ofertaEmergente.id_oferta || segundosOfertaEmergente <= 0}
                onClick={() => void rechazarOferta(ofertaEmergente)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                Rechazar
              </button>
            </>
          )}
        >
          <div
            data-testid={`tarjeta-oferta-${ofertaEmergente.id_oferta}`}
            className="space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-semibold">Nueva solicitud de viaje</span>
              <span
                data-testid={`cuenta-regresiva-${ofertaEmergente.id_oferta}`}
                className={`shrink-0 rounded-md border px-2 py-1 font-mono font-bold ${
                  segundosOfertaEmergente <= 10
                    ? "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-200"
                    : "border-[#4A7C59]/30 bg-[#E6EFE8] text-[#3B694A] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                }`}
              >
                {segundosOfertaEmergente > 0 ? `${segundosOfertaEmergente}s` : "Vencida"}
              </span>
            </div>
            <div className="space-y-2 rounded-xl border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800/70 p-4">
              <p><span className="font-semibold text-[#5E5B54] dark:text-slate-400">Origen:</span> {ofertaEmergente.origen?.direccion ?? (ofertaEmergente.origen ? `${ofertaEmergente.origen.latitud}, ${ofertaEmergente.origen.longitud}` : "Cargando dirección…")}</p>
              <p><span className="font-semibold text-[#5E5B54] dark:text-slate-400">Destino:</span> {ofertaEmergente.destino?.direccion ?? (ofertaEmergente.destino ? `${ofertaEmergente.destino.latitud}, ${ofertaEmergente.destino.longitud}` : "Cargando dirección…")}</p>
              <p className="border-t border-[#DDD8CC] dark:border-slate-700 pt-2 text-base font-extrabold">
                Precio confirmado: {ofertaEmergente.precio_estimado ? formatearImporteArs(ofertaEmergente.precio_estimado) : "Cargando…"}
              </p>
            </div>
            {alertaError && (
              <p role="alert" className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-800 dark:text-rose-200">
                {alertaError.mensaje}
              </p>
            )}
            {ofertaEmergenteBloqueada && (
              <p className="text-xs text-amber-800 dark:text-amber-300">Finalizá tu viaje actual para poder aceptar otra oferta.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
