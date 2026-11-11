import React, { useCallback, useEffect, useRef, useState } from "react";
import { clienteApi, ErrorHttpApi } from "../../nucleo/api";
import { obtenerSesion } from "../../nucleo/sesion";
import { clienteTiempoReal, EstadoConexionWs } from "../../nucleo/ws";

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
  estado: string;
}

export const RUTA_SIMULADA_RESISTENCIA: Array<{ latitud: number; longitud: number; etiqueta: string }> = [
  { latitud: -27.4512, longitud: -58.9866, etiqueta: "Plaza 25 de Mayo (Centro)" },
  { latitud: -27.4528, longitud: -58.9841, etiqueta: "Av. Alberdi 300" },
  { latitud: -27.4545, longitud: -58.9818, etiqueta: "Av. Las Heras y Franklin" },
  { latitud: -27.4569, longitud: -58.9795, etiqueta: "Av. Castelli 800" },
  { latitud: -27.4598, longitud: -58.9789, etiqueta: "UNNE Campus Resistencia" },
];

const ESTADOS_ACTIVOS_CHOFER = new Set(["asignado", "chofer_en_camino", "en_curso"]);

export function calcularSegundosRestantes(expiraEnIso: string, ahoraMs = Date.now()): number {
  const expiraMs = Date.parse(expiraEnIso);
  if (Number.isNaN(expiraMs)) return 0;
  return Math.max(0, Math.ceil((expiraMs - ahoraMs) / 1000));
}

export function formatearImporteArs(importe?: string): string {
  if (!importe) return "$ — ARS";
  const limpio = String(importe).replace(/[^\d]/g, "");
  if (!limpio) return `$ ${importe} ARS`;
  return `$ ${Number(limpio).toLocaleString("es-AR")} ARS`;
}

export function describirMotivoOferta(oferta: OfertaDto): string {
  if (oferta.estado === "vencida" || oferta.motivo === "vigencia_vencida") {
    return "Vencida (superó los 60s de vigencia)";
  }
  if (oferta.estado === "no_seleccionada" || oferta.motivo === "viaje_asignado") {
    return "Ya tomada por otro chofer";
  }
  if (oferta.estado === "cancelada" || oferta.motivo === "viaje_cancelado") {
    return "Cancelada por el pasajero u operador";
  }
  if (oferta.estado === "rechazada") {
    return "Rechazada por vos";
  }
  if (oferta.estado === "aceptada") {
    return "Aceptada — Viaje asignado";
  }
  return "No disponible";
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
  const idChoferActual = sesion?.idUsuario ?? "11111111-1111-4111-8111-111111111111";

  // Disponibilidad en ms-flota
  const [disponible, setDisponible] = useState<boolean>(false);
  const [cargandoDisponibilidad, setCargandoDisponibilidad] = useState<boolean>(false);

  // Ubicación manual y simulada en ms-flota
  const [latitudInput, setLatitudInput] = useState<string>("-27.4512");
  const [longitudInput, setLongitudInput] = useState<string>("-58.9866");
  const [ultimaUbicacion, setUltimaUbicacion] = useState<{
    latitud: number;
    longitud: number;
    actualizado_at: string;
    etiqueta?: string;
  } | null>(null);
  const [enviandoUbicacion, setEnviandoUbicacion] = useState<boolean>(false);
  const [simulandoGps, setSimulandoGps] = useState<boolean>(false);
  const indiceRutaRef = useRef<number>(0);

  // Ofertas y cuenta regresiva de 60s
  const [ofertas, setOfertas] = useState<OfertaDto[]>([]);
  const [ahoraMs, setAhoraMs] = useState<number>(() => Date.now());
  const [procesandoOfertaId, setProcesandoOfertaId] = useState<string | null>(null);

  // Viaje activo, historial reciente y cobro al finalizar
  const [viajeActivo, setViajeActivo] = useState<ViajeChoferDto | null>(null);
  const [ultimoCobro, setUltimoCobro] = useState<CobroChoferDto | null>(null);
  const [procesandoTransicion, setProcesandoTransicion] = useState<boolean>(false);

  // Alertas y errores (ej. 409 Conflict)
  const [alertaError, setAlertaError] = useState<{ codigo: string; mensaje: string; esConflicto409?: boolean } | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [estadoWs, setEstadoWs] = useState<EstadoConexionWs>(clienteTiempoReal.obtenerEstado());

  const tieneViajeEnCurso = Boolean(viajeActivo && ESTADOS_ACTIVOS_CHOFER.has(viajeActivo.estado.toLowerCase()));

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
        setDisponible(Boolean(respChofer.chofer.disponibilidad));
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
        for (const v of respViajes.viajes) {
          mapaViajes.set(v.id_viaje, v);
        }
        const activo = respViajes.viajes.find((v) => ESTADOS_ACTIVOS_CHOFER.has(v.estado.toLowerCase()));
        if (activo) {
          setViajeActivo(activo);
        }
      }

      if (respOfertas?.ofertas) {
        setOfertas(
          respOfertas.ofertas.map((of) => {
            const v = mapaViajes.get(of.id_viaje);
            return {
              ...of,
              origen: of.origen ?? v?.origen,
              destino: of.destino ?? v?.destino,
              precio_estimado: of.precio_estimado ?? v?.precio_estimado,
              moneda: of.moneda ?? v?.moneda ?? "ARS",
            };
          })
        );
      }
    } catch {
      // Modo offline o sin backend activo: mantiene estado en memoria
    }
  }, [idChoferActual]);

  useEffect(() => {
    void sincronizarEstadoServidor();
  }, [sincronizarEstadoServidor]);

  // Reloj de 1s para actualizar cuentas regresivas de 60s y marcar vencimientos locales exactos
  useEffect(() => {
    const intervalo = setInterval(() => {
      const instante = Date.now();
      setAhoraMs(instante);
      setOfertas((previas) =>
        previas.map((oferta) => {
          if (oferta.estado === "pendiente" && Date.parse(oferta.expira_en) <= instante) {
            return { ...oferta, estado: "vencida", motivo: "vigencia_vencida" };
          }
          return oferta;
        })
      );
    }, 1000);
    return () => clearInterval(intervalo);
  }, []);

  // Suscripción a eventos WebSocket y reconexión
  useEffect(() => {
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
          origen: (datos.origen as CoordenadaChofer | undefined) ?? {
            latitud: -27.451,
            longitud: -58.986,
            direccion: "Plaza 25 de Mayo",
          },
          destino: (datos.destino as CoordenadaChofer | undefined) ?? {
            latitud: -27.46,
            longitud: -58.979,
            direccion: "UNNE Campus Resistencia",
          },
          precio_estimado: datos.precio_estimado ? String(datos.precio_estimado) : datos.precio ? String(datos.precio) : undefined,
          moneda: "ARS",
        };

        setOfertas((prev) => {
          const sinDuplicado = prev.filter((item) => item.id_oferta !== idOferta);
          return [nuevaOferta, ...sinDuplicado];
        });

        // Consultar detalles del viaje si no vinieron en el payload efímero
        void clienteApi
          .get<ViajeChoferDto>(`/viajes/${encodeURIComponent(idViaje)}`)
          .then((detalleViaje) => {
            setOfertas((prev) =>
              prev.map((item) =>
                item.id_oferta === idOferta
                  ? {
                      ...item,
                      origen: detalleViaje.origen ?? item.origen,
                      destino: detalleViaje.destino ?? item.destino,
                      precio_estimado: detalleViaje.precio_estimado ?? item.precio_estimado,
                    }
                  : item
              )
            );
          })
          .catch(() => null);
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
        setViajeActivo((prev) => {
          if (!prev || prev.id_viaje !== idViaje) return prev;
          return { ...prev, estado: nuevoEstado };
        });
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
      setDisponible(Boolean(respuesta.disponibilidad));
      setMensajeExito(
        respuesta.disponibilidad
          ? "Disponibilidad activada en ms-flota. Ya podés recibir ofertas."
          : "Disponibilidad desactivada."
      );
      if (respuesta.disponibilidad) {
        void sincronizarEstadoServidor();
      }
    } catch (err) {
      if (err instanceof ErrorHttpApi) {
        if (err.status === 0) {
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
        if (err instanceof ErrorHttpApi && err.status === 0) {
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
    []
  );

  const manejarEnvioUbicacionManual = async (e: React.FormEvent) => {
    e.preventDefault();
    await reportarUbicacion(Number(latitudInput), Number(longitudInput), "Posición manual");
  };

  const avanzarPasoRutaSimulada = useCallback(async () => {
    const siguienteIndice = (indiceRutaRef.current + 1) % RUTA_SIMULADA_RESISTENCIA.length;
    indiceRutaRef.current = siguienteIndice;
    const punto = RUTA_SIMULADA_RESISTENCIA[siguienteIndice];
    await reportarUbicacion(punto.latitud, punto.longitud, punto.etiqueta);
  }, [reportarUbicacion]);

  // Temporizador de simulación GPS cada 2 segundos
  useEffect(() => {
    if (!simulandoGps) return;
    const timer = setInterval(() => {
      void avanzarPasoRutaSimulada();
    }, 2000);
    return () => clearInterval(timer);
  }, [simulandoGps, avanzarPasoRutaSimulada]);

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
        if (err.status === 0) {
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
                ? "La oferta venció antes de poder confirmarse (409)."
                : "La oferta ya fue tomada por otro chofer o no está disponible (409 Conflict).",
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
      if (err instanceof ErrorHttpApi && err.status === 0) {
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
      setViajeActivo(actualizado);
      setMensajeExito("Estado actualizado: Chofer en camino al punto de encuentro.");
    } catch (err) {
      if (err instanceof ErrorHttpApi && err.status === 0) {
        setViajeActivo({ ...viajeActivo, estado: "chofer_en_camino" });
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
      setViajeActivo(actualizado);
      setMensajeExito("Viaje en curso con el pasajero a bordo.");
    } catch (err) {
      if (err instanceof ErrorHttpApi && err.status === 0) {
        setViajeActivo({ ...viajeActivo, estado: "en_curso", iniciado_en: new Date().toISOString() });
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

    try {
      const resultado = await clienteApi.post<{ viaje: ViajeChoferDto; cobro: CobroChoferDto }>(
        `/viajes/${encodeURIComponent(viajeActivo.id_viaje)}/finalizacion`,
        {}
      );
      setViajeActivo(resultado.viaje);
      setUltimoCobro(resultado.cobro);
      setMensajeExito(`Viaje finalizado. Cobro ${resultado.cobro.id_cobro} confirmado.`);
    } catch (err) {
      if (err instanceof ErrorHttpApi && err.status === 0) {
        const finalizado: ViajeChoferDto = {
          ...viajeActivo,
          estado: "finalizado",
          precio_final: viajeActivo.precio_estimado,
          finalizado_en: new Date().toISOString(),
        };
        setViajeActivo(finalizado);
        setUltimoCobro({
          id_cobro: `cobro-demo-${Date.now()}`,
          importe: viajeActivo.precio_estimado,
          moneda: "ARS",
          estado: "confirmado",
        });
      } else if (err instanceof ErrorHttpApi) {
        setAlertaError({ codigo: err.codigo, mensaje: err.mensaje, esConflicto409: err.status === 409 });
      }
    } finally {
      setProcesandoTransicion(false);
    }
  };

  const estadoNormalizado = viajeActivo?.estado.toLowerCase() ?? "";
  const puedeMarcarEnCamino = estadoNormalizado === "asignado" && !procesandoTransicion;
  const puedeIniciarViaje = estadoNormalizado === "chofer_en_camino" && !procesandoTransicion;
  const puedeFinalizarViaje = estadoNormalizado === "en_curso" && !procesandoTransicion;

  return (
    <div className="space-y-6" data-testid="vista-chofer">
      {/* Encabezado y Toggle de Disponibilidad */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Panel de Chofer</span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-0.5">
            Hola, {sesion?.nombre || "Chofer"} 🚕
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Gestioná tu estado de disponibilidad en ms-flota, reportá tu posición GPS y recibí ofertas con vigencia de 60s.
          </p>
        </div>

        {/* Toggle de Disponibilidad */}
        <div className="flex items-center justify-between sm:justify-end gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-700">Disponibilidad:</span>
            <span
              id="estado-disponibilidad-chofer"
              data-testid="estado-disponibilidad-chofer"
              className="text-[11px] text-slate-500"
            >
              {disponible ? "Recibiendo ofertas" : "Fuera de servicio"}
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
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-slate-200 text-slate-700 hover:bg-slate-300"
            }`}
          >
            {cargandoDisponibilidad
              ? "Actualizando..."
              : disponible
                ? "Disponible (Activo)"
                : "No disponible"}
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
              ? "bg-amber-50 border-amber-300 text-amber-900"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <div className="space-y-0.5">
            <div className="font-bold flex items-center gap-1.5">
              <span>{alertaError.esConflicto409 ? "⚠️ Conflicto de concurrencia (409)" : "❌ Error en la operación"}</span>
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white/80 border border-current/20">
                {alertaError.codigo}
              </span>
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
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm flex items-center justify-between gap-3"
        >
          <span>✅ {mensajeExito}</span>
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

      {/* Grid Principal Responsive (360px 1 col -> 768px 2 cols -> 1024px+ 3 cols) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Columna 1: Bandeja de Ofertas en Tiempo Real */}
        <div className="md:col-span-1 space-y-4">
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <span>🔔</span> Ofertas Recibidas
              </h2>
              <span
                data-testid="indicador-ws-chofer"
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  estadoWs === "CONECTADO"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : estadoWs === "CONECTANDO"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {estadoWs === "CONECTADO" ? "WebSocket Activo" : estadoWs === "CONECTANDO" ? "Reconectando..." : "HTTP / Offline"}
              </span>
            </div>

            {/* Acciones de bandeja: Refrescar o Simular para Demo */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                id="boton-actualizar-ofertas"
                type="button"
                onClick={() => void sincronizarEstadoServidor()}
                className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-semibold text-slate-600 transition cursor-pointer"
              >
                ↻ Sincronizar GET
              </button>
              <button
                id="boton-simular-oferta"
                data-testid="boton-simular-oferta"
                type="button"
                onClick={simularOfertaEntrante}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-[11px] font-semibold text-indigo-700 border border-indigo-200 transition cursor-pointer"
              >
                + Simular oferta (60s)
              </button>
            </div>

            {!disponible && ofertas.length === 0 ? (
              <div
                data-testid="bandeja-ofertas-inactiva"
                className="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500"
              >
                Activá tu disponibilidad para comenzar a recibir ofertas de pasajeros cercanos.
              </div>
            ) : ofertas.length === 0 ? (
              <div
                data-testid="bandeja-ofertas-vacia"
                className="p-6 rounded-xl bg-emerald-50/40 border border-dashed border-emerald-200 text-center text-xs text-emerald-800"
              >
                Estás disponible y en línea. Esperando nuevas solicitudes de viaje cercanas...
              </div>
            ) : (
              <div className="space-y-3" data-testid="lista-ofertas-chofer">
                {ofertas.map((oferta) => {
                  const segundosRestantes = calcularSegundosRestantes(oferta.expira_en, ahoraMs);
                  const estaPendiente = oferta.estado === "pendiente" && segundosRestantes > 0;
                  const bloqueadaPorViajeActivo = tieneViajeEnCurso && viajeActivo?.id_viaje !== oferta.id_viaje;

                  return (
                    <div
                      key={oferta.id_oferta}
                      data-testid={`tarjeta-oferta-${oferta.id_oferta}`}
                      className={`p-4 rounded-xl border space-y-3 transition ${
                        estaPendiente
                          ? "border-indigo-200 bg-indigo-50/40"
                          : oferta.estado === "aceptada"
                            ? "border-emerald-200 bg-emerald-50/40"
                            : "border-slate-200 bg-slate-50 opacity-85"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-indigo-950 truncate" title={oferta.id_oferta}>
                          Oferta #{oferta.id_oferta}
                        </span>
                        {estaPendiente ? (
                          <span
                            data-testid={`cuenta-regresiva-${oferta.id_oferta}`}
                            className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md border ${
                              segundosRestantes <= 10
                                ? "text-rose-700 bg-rose-100 border-rose-300 animate-pulse"
                                : "text-rose-600 bg-rose-50 border-rose-200"
                            }`}
                          >
                            ⏱ {segundosRestantes}s
                          </span>
                        ) : (
                          <span
                            data-testid={`estado-oferta-${oferta.id_oferta}`}
                            className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-200 text-slate-700"
                          >
                            {oferta.estado.toUpperCase()}
                          </span>
                        )}
                      </div>

                      <div className="text-xs space-y-1 text-slate-700">
                        <div>
                          <span className="font-semibold text-slate-500">Viaje:</span>{" "}
                          <span className="font-mono text-[11px]">{oferta.id_viaje}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Origen:</span>{" "}
                          {oferta.origen?.direccion ??
                            (oferta.origen ? `${oferta.origen.latitud}, ${oferta.origen.longitud}` : "Resistencia Centro")}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Destino:</span>{" "}
                          {oferta.destino?.direccion ??
                            (oferta.destino ? `${oferta.destino.latitud}, ${oferta.destino.longitud}` : "Destino confirmado")}
                        </div>
                        {oferta.precio_estimado && (
                          <div className="pt-1 text-sm font-extrabold text-slate-900">
                            Importe: {formatearImporteArs(oferta.precio_estimado)}
                          </div>
                        )}
                      </div>

                      {estaPendiente ? (
                        <div className="space-y-1.5">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              data-testid={`boton-aceptar-${oferta.id_oferta}`}
                              disabled={procesandoOfertaId === oferta.id_oferta || bloqueadaPorViajeActivo}
                              onClick={() => void aceptarOferta(oferta)}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                                bloqueadaPorViajeActivo
                                  ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                                  : "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                              }`}
                            >
                              {procesandoOfertaId === oferta.id_oferta ? "Aceptando..." : "Aceptar"}
                            </button>
                            <button
                              type="button"
                              data-testid={`boton-rechazar-${oferta.id_oferta}`}
                              disabled={procesandoOfertaId === oferta.id_oferta}
                              onClick={() => void rechazarOferta(oferta)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
                            >
                              Rechazar
                            </button>
                          </div>
                          {bloqueadaPorViajeActivo && (
                            <p className="text-[11px] text-amber-700 font-medium">
                              Invariante: ya tenés un viaje activo en curso.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div
                          data-testid={`motivo-oferta-${oferta.id_oferta}`}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600"
                        >
                          Motivo: <span className="font-bold text-slate-800">{describirMotivoOferta(oferta)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Columna 2 y 3: Viaje Asignado, Controles de Transición y Reporte de Ubicación */}
        <div className="md:col-span-1 lg:col-span-2 space-y-6">
          {/* Tarjeta de Viaje Asignado y Máquina de Estados */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <span>🚕</span> Viaje Asignado
              </h2>
              <span
                id="estado-viaje-chofer"
                data-testid="estado-viaje-chofer"
                className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                  tieneViajeEnCurso
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : estadoNormalizado === "finalizado"
                      ? "bg-indigo-50 text-indigo-800 border-indigo-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {etiquetaEstadoViaje(viajeActivo?.estado)}
              </span>
            </div>

            {viajeActivo ? (
              <div
                data-testid="detalle-viaje-asignado"
                className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"
              >
                <div>
                  <span className="text-slate-500 font-semibold block">ID de Viaje</span>
                  <span className="font-mono font-bold text-slate-900">{viajeActivo.id_viaje}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold block">Precio Congelado</span>
                  <span className="font-extrabold text-emerald-700 text-sm">
                    {formatearImporteArs(viajeActivo.precio_final ?? viajeActivo.precio_estimado)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold block">Origen</span>
                  <span className="text-slate-800">
                    {viajeActivo.origen.direccion ??
                      `${viajeActivo.origen.latitud.toFixed(4)}, ${viajeActivo.origen.longitud.toFixed(4)}`}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold block">Destino</span>
                  <span className="text-slate-800">
                    {viajeActivo.destino.direccion ??
                      `${viajeActivo.destino.latitud.toFixed(4)}, ${viajeActivo.destino.longitud.toFixed(4)}`}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-5 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
                No tenés un viaje activo en este momento. Aceptá una oferta de la bandeja para asignarte un recorrido.
              </div>
            )}

            {/* Resumen de Cobro cuando finaliza */}
            {ultimoCobro && (
              <div
                id="resumen-cobro-chofer"
                data-testid="resumen-cobro-chofer"
                className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-950"
              >
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] text-emerald-700 block">
                    Recibo de Cobro Generado
                  </span>
                  <span className="font-semibold">
                    Cobro #{ultimoCobro.id_cobro} — Estado: {ultimoCobro.estado.toUpperCase()}
                  </span>
                </div>
                <span className="text-base font-extrabold text-emerald-800">
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
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 cursor-pointer shadow-xs"
                    : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
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
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 cursor-pointer shadow-xs"
                    : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
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
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 cursor-pointer shadow-xs"
                    : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                }`}
              >
                3. Finalizar y Cobrar
              </button>
            </div>
          </div>

          {/* Tarjeta de Envío de Ubicación Manual y Simulación GPS en Resistencia */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                  <span>📍</span> Reporte de Ubicación y Simulador GPS
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Envía coordenadas a <code className="font-mono text-[11px]">POST /choferes/yo/ubicacion</code> (ms-flota).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  id="boton-paso-simulacion-gps"
                  data-testid="boton-paso-simulacion-gps"
                  type="button"
                  disabled={enviandoUbicacion}
                  onClick={() => void avanzarPasoRutaSimulada()}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  Avanzar 1 paso GPS
                </button>
                <button
                  id="boton-simulacion-gps"
                  data-testid="boton-simulacion-gps"
                  type="button"
                  onClick={() => setSimulandoGps((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    simulandoGps
                      ? "bg-amber-600 hover:bg-amber-700 text-white"
                      : "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200"
                  }`}
                >
                  {simulandoGps ? "⏹ Detener ruta (2s)" : "▶ Simular ruta cada 2s"}
                </button>
              </div>
            </div>

            {/* Formulario de envío manual de coordenadas */}
            <form onSubmit={(e) => void manejarEnvioUbicacionManual(e)} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label htmlFor="input-latitud-chofer" className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Latitud (Resistencia)
                </label>
                <input
                  id="input-latitud-chofer"
                  data-testid="input-latitud-chofer"
                  type="number"
                  step="0.0001"
                  value={latitudInput}
                  onChange={(e) => setLatitudInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label htmlFor="input-longitud-chofer" className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Longitud (Resistencia)
                </label>
                <input
                  id="input-longitud-chofer"
                  data-testid="input-longitud-chofer"
                  type="number"
                  step="0.0001"
                  value={longitudInput}
                  onChange={(e) => setLongitudInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                id="boton-enviar-ubicacion"
                data-testid="boton-enviar-ubicacion"
                type="submit"
                disabled={enviandoUbicacion}
                className="w-full py-2 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
              >
                {enviandoUbicacion ? "Enviando..." : "Enviar Ubicación"}
              </button>
            </form>

            {/* Última posición confirmada */}
            <div
              id="ultima-ubicacion-chofer"
              data-testid="ultima-ubicacion-chofer"
              className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600"
            >
              {ultimaUbicacion ? (
                <>
                  <div>
                    <span className="font-semibold text-slate-800">Última ubicación reportada: </span>
                    <span className="font-mono">
                      [{ultimaUbicacion.latitud.toFixed(4)}, {ultimaUbicacion.longitud.toFixed(4)}]
                    </span>
                    {ultimaUbicacion.etiqueta && (
                      <span className="ml-2 text-emerald-700 font-semibold">— {ultimaUbicacion.etiqueta}</span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
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
    </div>
  );
};
