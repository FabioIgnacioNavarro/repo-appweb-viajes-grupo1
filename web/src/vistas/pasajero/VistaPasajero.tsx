import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clienteApi, ErrorHttpApi, generarClaveIdempotencia } from "../../nucleo/api";
import { obtenerSesion } from "../../nucleo/sesion";
import { clienteTiempoReal } from "../../nucleo/ws";
import { InsigniaEstadoViaje } from "../../componentes/comunes";
import { MapaLeaflet, type PuntoMapa } from "../../componentes/mapa/MapaLeaflet";
import { PanelDesarrollador, type FactoresVisualizacion, type ParametrosSimulacion } from "../../componentes/dev/PanelDesarrollador";
import { useModoDesarrollador } from "../../nucleo/modoDesarrollador";

interface Coordenada {
  latitud: number;
  longitud: number;
  direccion?: string;
}

interface EstimacionDto {
  id_estimacion: string;
  precio_estimado: string;
  moneda: "ARS";
  distancia_metros: number;
  duracion_segundos: number;
  proveedor_ruta?: "OSRM" | "GOOGLE" | "HAVERSINE";
  multiplicador_demanda: number;
  zona: string;
  factores_precio: Record<string, unknown>;
  recomendaciones?: string[];
  version_regla: number;
  creada_en: string;
  vigente_hasta: string;
  origen: Coordenada;
  destino: Coordenada;
  polilinea: string | null;
}

interface ViajeDto {
  id_viaje: string;
  pasajero_id?: string;
  id_estimacion: string;
  precio_estimado: string;
  precio_final: string | null;
  moneda: "ARS";
  multiplicador_demanda: number;
  factores_precio: Record<string, unknown>;
  estado: string;
  creado_en: string;
  origen: Coordenada;
  destino: Coordenada;
}

interface DatosViajes {
  viajes: ViajeDto[];
}

interface CobroDto {
  id_cobro: string;
  id_viaje: string;
  importe: string;
  moneda: "ARS";
  estado: "pendiente" | "fallido" | "confirmado";
  intentos: number;
  creado_en: string;
}

interface ErrorVisible {
  codigo: string;
  mensaje: string;
}

const ESTADOS_ACTIVOS = new Set(["solicitado", "asignado", "chofer_en_camino", "en_curso"]);
const ESTADOS_CANCELABLES_PASAJERO = new Set(["solicitado", "asignado", "chofer_en_camino"]);

function importePesos(importe: string): string {
  const digitos = importe.replace(/\D/g, "");
  return `$ ${digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ARS`;
}

function errorVisible(error: unknown, codigoPredeterminado: string, mensajePredeterminado: string): ErrorVisible {
  if (error instanceof ErrorHttpApi) return { codigo: error.codigo, mensaje: error.mensaje };
  return { codigo: codigoPredeterminado, mensaje: mensajePredeterminado };
}

function decodificarPolilinea(polilinea: string, precision: number): Coordenada[] {
  const puntos: Coordenada[] = [];
  let indice = 0;
  let latitud = 0;
  let longitud = 0;

  const leerDelta = (): number => {
    let resultado = 0;
    let desplazamiento = 0;
    let continuar: number;
    do {
      if (indice >= polilinea.length || desplazamiento > 30) throw new Error("Polilínea inválida.");
      continuar = polilinea.charCodeAt(indice++) - 63;
      if (continuar < 0 || continuar > 63) throw new Error("Polilínea inválida.");
      resultado |= (continuar & 0x1f) << desplazamiento;
      desplazamiento += 5;
    } while (continuar >= 0x20);
    return (resultado & 1) ? ~(resultado >> 1) : resultado >> 1;
  };

  while (indice < polilinea.length) {
    latitud += leerDelta();
    longitud += leerDelta();
    puntos.push({ latitud: latitud / 10 ** precision, longitud: longitud / 10 ** precision });
    if (puntos.length > 20_000) throw new Error("La ruta recibida es demasiado extensa.");
  }
  return puntos;
}

function puntosDeRuta(estimacion: EstimacionDto): Coordenada[] {
  if (!estimacion.polilinea || estimacion.proveedor_ruta === "HAVERSINE") return [];
  if (estimacion.proveedor_ruta === "GOOGLE" || estimacion.proveedor_ruta === "OSRM") {
    try {
      const precision = estimacion.proveedor_ruta === "GOOGLE" ? 5 : 6;
      return decodificarPolilinea(estimacion.polilinea, precision);
    } catch {
      return [];
    }
  }
  const opciones = [6, 5].flatMap((precision) => {
    try {
      const puntos = decodificarPolilinea(estimacion.polilinea!, precision);
      if (puntos.length < 2) return [];
      const errorDirecto =
        Math.abs(puntos[0].latitud - estimacion.origen.latitud) +
        Math.abs(puntos[0].longitud - estimacion.origen.longitud) +
        Math.abs(puntos[puntos.length - 1].latitud - estimacion.destino.latitud) +
        Math.abs(puntos[puntos.length - 1].longitud - estimacion.destino.longitud);
      return [{ puntos, error: errorDirecto }];
    } catch {
      return [];
    }
  });
  return opciones.sort((a, b) => a.error - b.error)[0]?.puntos ?? [];
}

function etiquetaEstado(estado: string): string {
  const etiquetas: Record<string, string> = {
    solicitado: "Buscando chofer",
    asignado: "Chofer asignado",
    chofer_en_camino: "Chofer en camino",
    en_curso: "Viaje en curso",
    finalizado: "Viaje finalizado",
    sin_choferes_disponibles: "Sin choferes disponibles",
    cancelado_por_pasajero: "Cancelado por vos",
    cancelado_por_chofer: "Cancelado por el chofer",
    cancelado_por_operador: "Cancelado por soporte"
  };
  return etiquetas[estado.toLowerCase()] ?? estado.replaceAll("_", " ");
}

function formatearTiempo(segundos: number): string {
  const minutos = Math.floor(segundos / 60).toString().padStart(2, "0");
  const resto = (segundos % 60).toString().padStart(2, "0");
  return `${minutos}:${resto}`;
}

const camposFactor = [
  { clave: "llueve", etiqueta: "Lluvia", mostrar: (valor: unknown) => valor === true ? "Sí" : "No" },
  { clave: "choferes_disponibles", etiqueta: "Choferes disponibles", mostrar: (valor: unknown) => String(valor ?? "—") },
  { clave: "solicitudes_activas", etiqueta: "Demanda en la zona", mostrar: (valor: unknown) => String(valor ?? "—") },
  { clave: "franja_horaria", etiqueta: "Franja horaria", mostrar: (valor: unknown) => String(valor ?? "—") }
];

type PuntoSolicitud = { direccion: string } | Coordenada;

export const VistaPasajero: React.FC = () => {
  const sesion = obtenerSesion();
  const { modoDev } = useModoDesarrollador();
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [pinManualOrigen, setPinManualOrigen] = useState<Coordenada | null>(null);
  const [pinManualDestino, setPinManualDestino] = useState<Coordenada | null>(null);
  const [estimacion, setEstimacion] = useState<EstimacionDto | null>(null);
  const [polilineaViaje, setPolilineaViaje] = useState<[number, number][] | undefined>(undefined);
  const [viaje, setViaje] = useState<ViajeDto | null>(null);
  const [cobro, setCobro] = useState<CobroDto | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const [procesando, setProcesando] = useState(false);
  const [calculandoEstimacion, setCalculandoEstimacion] = useState(false);
  const [error, setError] = useState<ErrorVisible | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [panelDevActivo, setPanelDevActivo] = useState(false);
  const [parametrosSimulacion, setParametrosSimulacion] = useState<ParametrosSimulacion>({});
  const parametrosSimulacionRef = useRef<ParametrosSimulacion>({});
  const modoDevRef = useRef(modoDev);
  const claveConfirmacion = useRef<string | null>(null);
  const bloqueoEnvio = useRef(false);
  const viajeActualRef = useRef<ViajeDto | null>(null);
  const secuenciaGeoInversaRef = useRef<{ origen: number; destino: number }>({ origen: 0, destino: 0 });
  const secuenciaEstimacionRef = useRef(0);
  const debounceEstimacionRef = useRef<number | null>(null);

  useEffect(() => {
    modoDevRef.current = modoDev;
    if (!modoDev) {
      setPanelDevActivo(false);
      parametrosSimulacionRef.current = {};
      setParametrosSimulacion({});
    }
  }, [modoDev]);

  useEffect(() => {
    viajeActualRef.current = viaje;
  }, [viaje]);

  const sincronizarViajeActivo = useCallback(async () => {
    try {
      const respuesta = await clienteApi.get<DatosViajes>("/viajes");
      const listaFiltrada =
        sesion?.rol === "ADMINISTRADOR" && sesion.idUsuario
          ? respuesta.viajes.filter((elemento) => !elemento.pasajero_id || elemento.pasajero_id === sesion.idUsuario)
          : respuesta.viajes;
      const ordenados = listaFiltrada
        .sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en));
      const activo = ordenados.find((elemento) => ESTADOS_ACTIVOS.has(elemento.estado.toLowerCase()));
      const ultimoFinalizado = ordenados.find((elemento) => elemento.estado.toLowerCase() === "finalizado");
      const viajeMostrable = activo ?? ultimoFinalizado ?? null;
      setViaje(viajeMostrable);
      if (viajeMostrable?.estado.toLowerCase() === "finalizado") {
        try {
          const recibo = await clienteApi.get<CobroDto>(`/viajes/${encodeURIComponent(viajeMostrable.id_viaje)}/cobro`);
          setCobro(recibo);
          setAviso(`Viaje finalizado. Total a pagar: ${importePesos(recibo.importe)} (Pago ${recibo.estado}).`);
        } catch {
          setCobro(null);
        }
      } else {
        setCobro(null);
      }
    } catch {
      // La vista conserva el estado visible si el backend no está disponible temporalmente.
    }
  }, [sesion?.idUsuario, sesion?.rol]);

  useEffect(() => {
    if (sesion?.rol !== "PASAJERO" && sesion?.rol !== "ADMINISTRADOR") return;
    void sincronizarViajeActivo();
    return clienteTiempoReal.alReconectar(() => { void sincronizarViajeActivo(); });
  }, [sesion?.rol, sincronizarViajeActivo]);

  useEffect(() => {
    const temporizador = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(temporizador);
  }, []);

  useEffect(() => {
    const desuscribir = clienteTiempoReal.on("ESTADO_VIAJE_ACTUALIZADO", (eventoRaw) => {
      const evento = eventoRaw as { datos?: { id_viaje?: string; estado?: string } };
      const datos = evento.datos;
      if (!datos?.id_viaje || !datos.estado) return;
      if (viajeActualRef.current?.id_viaje === datos.id_viaje) {
        setViaje((actual) => actual ? { ...actual, estado: datos.estado! } : actual);
        if (datos.estado.toLowerCase() === "finalizado") void sincronizarViajeActivo();
      } else {
        void sincronizarViajeActivo();
      }
    });
    return desuscribir;
  }, [sincronizarViajeActivo]);

  const segundosVigencia = estimacion
    ? Math.max(0, Math.ceil((Date.parse(estimacion.vigente_hasta) - ahora) / 1000))
    : 0;
  const estadoViaje = viaje?.estado.toLowerCase() ?? "";
  const hayViajeEnCurso = Boolean(viaje && ESTADOS_ACTIVOS.has(estadoViaje));
  const origenMapa =
    estimacion?.origen ??
    pinManualOrigen ??
    (hayViajeEnCurso && viaje ? viaje.origen : undefined);
  const destinoMapa = estimacion?.destino ?? pinManualDestino ?? (hayViajeEnCurso && viaje ? viaje.destino : undefined);
  const puedeCancelar = Boolean(viaje && ESTADOS_CANCELABLES_PASAJERO.has(estadoViaje));

  const cancelarDebounceEstimacion = useCallback(() => {
    if (debounceEstimacionRef.current !== null) {
      window.clearTimeout(debounceEstimacionRef.current);
      debounceEstimacionRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelarDebounceEstimacion(), [cancelarDebounceEstimacion]);

  const rutaMapa = useMemo<[number, number][] | undefined>(() => {
    if (estimacion) {
      const puntos = puntosDeRuta(estimacion);
      return puntos.length >= 2
        ? puntos.map((p) => [p.latitud, p.longitud] as [number, number])
        : undefined;
    }
    if (polilineaViaje && polilineaViaje.length >= 2) {
      return polilineaViaje;
    }
    return undefined;
  }, [estimacion, polilineaViaje]);

  const origenLatitud = origenMapa?.latitud;
  const origenLongitud = origenMapa?.longitud;
  const origenPinMapa = useMemo<PuntoMapa | undefined>(
    () =>
      origenLatitud !== undefined && origenLongitud !== undefined
        ? { latitud: origenLatitud, longitud: origenLongitud, titulo: origen, tipo: "origen" }
        : undefined,
    [origenLatitud, origenLongitud, origen]
  );

  const destinoLatitud = destinoMapa?.latitud;
  const destinoLongitud = destinoMapa?.longitud;
  const destinoPinMapa = useMemo<PuntoMapa | undefined>(
    () =>
      destinoLatitud !== undefined && destinoLongitud !== undefined
        ? { latitud: destinoLatitud, longitud: destinoLongitud, titulo: destino, tipo: "destino" }
        : undefined,
    [destinoLatitud, destinoLongitud, destino]
  );

  const invalidarEstimacion = useCallback(() => {
    cancelarDebounceEstimacion();
    secuenciaEstimacionRef.current += 1;
    setCalculandoEstimacion(false);
    setEstimacion(null);
    setPolilineaViaje(undefined);
    claveConfirmacion.current = null;
    setError(null);
    setAviso(null);
  }, [cancelarDebounceEstimacion]);

  const ejecutarEstimacion = useCallback(async (puntoOrigen: PuntoSolicitud, puntoDestino: PuntoSolicitud) => {
    secuenciaEstimacionRef.current += 1;
    const turno = secuenciaEstimacionRef.current;
    setCalculandoEstimacion(true);
    setError(null);
    setAviso(null);
    try {
      const sim = parametrosSimulacionRef.current;
      const haySimulacion =
        sim.hora !== undefined ||
        sim.llueve !== undefined ||
        sim.choferesDisponibles !== undefined ||
        sim.solicitudesActivas !== undefined;
      const cuerpo: Record<string, unknown> = {
        origen: puntoOrigen,
        destino: puntoDestino
      };
      if (modoDevRef.current && haySimulacion) {
        cuerpo.simulacion = {
          ...(sim.hora !== undefined ? { hora: sim.hora } : {}),
          ...(sim.llueve !== undefined ? { llueve: sim.llueve } : {}),
          ...(sim.choferesDisponibles !== undefined ? { choferes_disponibles: sim.choferesDisponibles } : {}),
          ...(sim.solicitudesActivas !== undefined ? { solicitudes_activas: sim.solicitudesActivas } : {})
        };
      }
      const respuesta = await clienteApi.post<EstimacionDto>("/viajes/estimacion", cuerpo);
      if (secuenciaEstimacionRef.current !== turno) return;
      setEstimacion(respuesta);
      claveConfirmacion.current = null;
      setCobro(null);
      setViaje(null);
      setAviso("Precio calculado. Se mantiene vigente durante tres minutos.");
    } catch (causa) {
      if (secuenciaEstimacionRef.current !== turno) return;
      setError(errorVisible(causa, "ESTIMACION_NO_DISPONIBLE", "No se pudo calcular el precio. Revisá las direcciones e intentá nuevamente."));
    } finally {
      if (secuenciaEstimacionRef.current === turno) {
        setCalculandoEstimacion(false);
      }
    }
  }, []);

  const programarEstimacionAutomatica = useCallback(
    (textoOrigen: string, textoDestino: string, pinOrig: Coordenada | null, pinDest: Coordenada | null) => {
      invalidarEstimacion();
      if (puedeCancelar) return;
      const oTexto = textoOrigen.trim();
      const dTexto = textoDestino.trim();
      const origenValido = Boolean(pinOrig) || (oTexto.length >= 3 && oTexto !== "Buscando dirección...");
      const destinoValido = Boolean(pinDest) || (dTexto.length >= 3 && dTexto !== "Buscando dirección...");
      if (!origenValido || !destinoValido) return;

      const puntoOrigen: PuntoSolicitud = pinOrig ?? { direccion: oTexto };
      const puntoDestino: PuntoSolicitud = pinDest ?? { direccion: dTexto };

      debounceEstimacionRef.current = window.setTimeout(() => {
        debounceEstimacionRef.current = null;
        void ejecutarEstimacion(puntoOrigen, puntoDestino);
      }, 750);
    },
    [invalidarEstimacion, puedeCancelar, ejecutarEstimacion]
  );

  const reestimarConSimulacion = useCallback(
    (nuevosParametros: ParametrosSimulacion) => {
      parametrosSimulacionRef.current = nuevosParametros;
      setParametrosSimulacion(nuevosParametros);
      if (puedeCancelar) return;
      const oTexto = origen.trim();
      const dTexto = destino.trim();
      const origenValido = Boolean(pinManualOrigen) || (oTexto.length >= 3 && oTexto !== "Buscando dirección...");
      const destinoValido = Boolean(pinManualDestino) || (dTexto.length >= 3 && dTexto !== "Buscando dirección...");
      if (!origenValido || !destinoValido) return;

      cancelarDebounceEstimacion();
      const puntoOrigen: PuntoSolicitud = pinManualOrigen ?? { direccion: oTexto };
      const puntoDestino: PuntoSolicitud = pinManualDestino ?? { direccion: dTexto };
      debounceEstimacionRef.current = window.setTimeout(() => {
        debounceEstimacionRef.current = null;
        void ejecutarEstimacion(puntoOrigen, puntoDestino);
      }, 250);
    },
    [puedeCancelar, origen, destino, pinManualOrigen, pinManualDestino, cancelarDebounceEstimacion, ejecutarEstimacion]
  );

  const restablecerSimulacion = useCallback(() => {
    reestimarConSimulacion({});
  }, [reestimarConSimulacion]);

  const factoresDev = useMemo<FactoresVisualizacion | undefined>(() => {
    if (!estimacion) return undefined;
    const f = estimacion.factores_precio ?? {};
    return {
      factorHorario: typeof f.factor_horario === "number" ? f.factor_horario : undefined,
      franjaHoraria: typeof f.franja_horaria === "string" ? f.franja_horaria.toUpperCase() : undefined,
      factorLluvia: typeof f.factor_lluvia === "number" ? f.factor_lluvia : undefined,
      llueve: typeof f.llueve === "boolean" ? f.llueve : undefined,
      factorDisponibilidad: typeof f.factor_disponibilidad === "number" ? f.factor_disponibilidad : undefined,
      choferesDisponibles: typeof f.choferes_disponibles === "number" ? f.choferes_disponibles : undefined,
      factorDemanda: typeof f.factor_demanda === "number" ? f.factor_demanda : undefined,
      solicitudesActivas: typeof f.solicitudes_activas === "number" ? f.solicitudes_activas : undefined,
      multiplicadorDemanda: estimacion.multiplicador_demanda
    };
  }, [estimacion]);

  const manejarPinArrastrado = useCallback(
    (tipo: "origen" | "destino", coords: [number, number]) => {
      if (puedeCancelar) return;
      const coordenada: Coordenada = { latitud: coords[0], longitud: coords[1] };
      const origenPrevioPin = pinManualOrigen ?? (estimacion?.origen ?? null);
      const destinoPrevioPin = pinManualDestino ?? (estimacion?.destino ?? null);

      if (tipo === "origen") {
        setPinManualOrigen(coordenada);
        setOrigen("Buscando dirección...");
        if (!pinManualDestino && estimacion?.destino) {
          setPinManualDestino(estimacion.destino);
        }
      } else {
        setPinManualDestino(coordenada);
        setDestino("Buscando dirección...");
        if (!pinManualOrigen && estimacion?.origen) {
          setPinManualOrigen(estimacion.origen);
        }
      }
      invalidarEstimacion();

      secuenciaGeoInversaRef.current[tipo] += 1;
      const turno = secuenciaGeoInversaRef.current[tipo];

      const completarPunto = (direccion: string) => {
        const puntoActualizado: Coordenada = { ...coordenada, direccion };
        if (tipo === "origen") {
          setOrigen(direccion);
          setPinManualOrigen(puntoActualizado);
        } else {
          setDestino(direccion);
          setPinManualDestino(puntoActualizado);
        }

        const puntoOrigenAuto: PuntoSolicitud | null = tipo === "origen"
          ? puntoActualizado
          : origenPrevioPin ?? (origen.trim() && origen !== "Buscando dirección..." ? { direccion: origen.trim() } : null);
        const puntoDestinoAuto: PuntoSolicitud | null = tipo === "destino"
          ? puntoActualizado
          : destinoPrevioPin ?? (destino.trim() && destino !== "Buscando dirección..." ? { direccion: destino.trim() } : null);

        if (puntoOrigenAuto && puntoDestinoAuto) {
          void ejecutarEstimacion(puntoOrigenAuto, puntoDestinoAuto);
        }
      };

      void clienteApi
        .post<{ direccion: string }>("/tarifas/geocodificacion-inversa", coordenada)
        .then((res) => {
          if (secuenciaGeoInversaRef.current[tipo] !== turno) return;
          completarPunto(res.direccion?.trim() || `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`);
        })
        .catch(() => {
          if (secuenciaGeoInversaRef.current[tipo] !== turno) return;
          completarPunto(`${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`);
        });
    },
    [puedeCancelar, invalidarEstimacion, pinManualOrigen, pinManualDestino, estimacion, origen, destino, ejecutarEstimacion]
  );

  const solicitarEstimacion = (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (puedeCancelar) return;
    const oTexto = origen.trim();
    const dTexto = destino.trim();
    if (!oTexto || !dTexto || oTexto === "Buscando dirección..." || dTexto === "Buscando dirección...") {
      if (!pinManualOrigen && !oTexto) {
        setError({ codigo: "ENTRADA_INVALIDA", mensaje: "Completá el origen y el destino para calcular el precio." });
      }
      return;
    }
    cancelarDebounceEstimacion();
    const puntoOrigen: PuntoSolicitud = pinManualOrigen ?? { direccion: oTexto };
    const puntoDestino: PuntoSolicitud = pinManualDestino ?? { direccion: dTexto };
    void ejecutarEstimacion(puntoOrigen, puntoDestino);
  };

  const confirmarViaje = async () => {
    if (!estimacion || segundosVigencia <= 0 || bloqueoEnvio.current) return;
    bloqueoEnvio.current = true;
    setProcesando(true);
    setError(null);
    setAviso(null);
    const clave = claveConfirmacion.current ?? generarClaveIdempotencia();
    claveConfirmacion.current = clave;
    try {
      const confirmado = await clienteApi.post<ViajeDto>("/viajes", { id_estimacion: estimacion.id_estimacion }, { claveIdempotencia: clave });
      const rutaConfirmada = puntosDeRuta(estimacion).map((p) => [p.latitud, p.longitud] as [number, number]);
      setPolilineaViaje(rutaConfirmada.length >= 2 ? rutaConfirmada : undefined);
      setViaje(confirmado);
      setAviso(confirmado.estado.toLowerCase() === "sin_choferes_disponibles"
        ? "No hay choferes disponibles en este momento. El precio de esta estimación se conserva."
        : "Viaje solicitado. El precio confirmado quedó congelado.");
    } catch (causa) {
      const alerta = errorVisible(causa, "CONFIRMACION_NO_DISPONIBLE", "No se pudo confirmar el viaje. Podés reintentar con la misma solicitud.");
      setError(alerta);
      if (alerta.codigo === "ESTIMACION_VENCIDA") {
        setEstimacion(null);
        claveConfirmacion.current = null;
      }
    } finally {
      bloqueoEnvio.current = false;
      setProcesando(false);
    }
  };

  const cancelarViaje = async () => {
    if (!viaje || !puedeCancelar || bloqueoEnvio.current) return;
    bloqueoEnvio.current = true;
    setProcesando(true);
    setError(null);
    setAviso(null);
    try {
      const cancelado = await clienteApi.post<ViajeDto>(`/viajes/${encodeURIComponent(viaje.id_viaje)}/cancelacion`, {
        motivo: "Cancelación solicitada por el pasajero"
      });
      setViaje(cancelado);
      setAviso("El viaje fue cancelado.");
    } catch (causa) {
      setError(errorVisible(causa, "CANCELACION_NO_DISPONIBLE", "No se pudo cancelar el viaje. Actualizá el estado e intentá nuevamente."));
      await sincronizarViajeActivo();
    } finally {
      bloqueoEnvio.current = false;
      setProcesando(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-7xl space-y-6" aria-labelledby="titulo-pasajero">
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-[#DDD8CC] dark:border-slate-800 bg-[#EFECE4] dark:bg-slate-900 p-5 shadow-sm sm:flex-row sm:items-center sm:p-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#4A7C59] dark:text-emerald-400">Panel de pasajero</p>
          <h1 id="titulo-pasajero" className="mt-1 text-2xl font-extrabold text-[#2C2B28] dark:text-slate-100">Hola, {sesion?.nombre || "Pasajero"}</h1>
          <p className="mt-1 text-sm text-[#5E5B54] dark:text-slate-400">Cotizá tu recorrido y confirmá el precio antes de pedir el viaje.</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          <strong>{error.codigo}:</strong> {error.mensaje}
        </div>
      )}
      {aviso && <p role="status" className="rounded-xl border border-[#4A7C59]/30 dark:border-emerald-900/60 bg-[#E6EFE8] dark:bg-emerald-950/30 px-4 py-3 text-sm text-[#2C2B28] dark:text-emerald-200">{aviso}</p>}

      {modoDev && (
        <PanelDesarrollador
          activo={panelDevActivo}
          onAlternarActivo={() => setPanelDevActivo((prev) => !prev)}
          parametros={parametrosSimulacion}
          onCambiarParametros={reestimarConSimulacion}
          onRestablecer={restablecerSimulacion}
          factores={factoresDev}
          recomendaciones={estimacion?.recomendaciones}
        />
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-5">
          <form onSubmit={solicitarEstimacion} className="space-y-4 rounded-2xl border border-[#DDD8CC] dark:border-slate-800 bg-[#EFECE4] dark:bg-slate-900 p-5 shadow-sm" aria-label="Calcular estimación del viaje">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-[#2C2B28] dark:text-slate-100">Tu recorrido</h2>
              <p className="mt-1 text-xs text-[#5E5B54] dark:text-slate-400">Ingresá un destino o tocá el mapa para cotizar al instante.</p>
            </div>
            <label className="block text-xs font-semibold text-[#2C2B28] dark:text-slate-300" htmlFor="origen-viaje">
              Origen
              <input
                id="origen-viaje"
                name="origen"
                autoComplete="street-address"
                value={origen}
                onChange={(evento) => {
                  const nuevoOrigen = evento.target.value;
                  setOrigen(nuevoOrigen);
                  setPinManualOrigen(null);
                  programarEstimacionAutomatica(nuevoOrigen, destino, null, pinManualDestino);
                }}
                disabled={puedeCancelar}
                className="mt-1.5 w-full rounded-lg border border-[#D4CFC2] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-900 text-[#2C2B28] dark:text-slate-100 placeholder:text-[#7A776F] px-3 py-2.5 text-sm font-normal outline-none transition focus:bg-[#FCFBF8] dark:focus:bg-slate-950 focus:border-[#4A7C59] focus:ring-2 focus:ring-[#4A7C59]/20 dark:focus:ring-emerald-950 disabled:bg-[#E5E0D4] dark:disabled:bg-slate-800"
                placeholder="Ej: Av. Alberdi 250, Resistencia"
                required
              />
            </label>
            <label className="block text-xs font-semibold text-[#2C2B28] dark:text-slate-300" htmlFor="destino-viaje">
              Destino
              <input
                id="destino-viaje"
                name="destino"
                autoComplete="street-address"
                value={destino}
                onChange={(evento) => {
                  const nuevoDestino = evento.target.value;
                  setDestino(nuevoDestino);
                  setPinManualDestino(null);
                  programarEstimacionAutomatica(origen, nuevoDestino, pinManualOrigen, null);
                }}
                onBlur={() => {
                  if (debounceEstimacionRef.current === null || puedeCancelar) return;
                  const oTexto = origen.trim();
                  const dTexto = destino.trim();
                  const origenValido = Boolean(pinManualOrigen) || (oTexto.length >= 3 && oTexto !== "Buscando dirección...");
                  const destinoValido = Boolean(pinManualDestino) || (dTexto.length >= 3 && dTexto !== "Buscando dirección...");
                  if (!origenValido || !destinoValido) return;
                  cancelarDebounceEstimacion();
                  void ejecutarEstimacion(
                    pinManualOrigen ?? { direccion: oTexto },
                    pinManualDestino ?? { direccion: dTexto }
                  );
                }}
                disabled={puedeCancelar}
                className="mt-1.5 w-full rounded-lg border border-[#D4CFC2] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-900 text-[#2C2B28] dark:text-slate-100 placeholder:text-[#7A776F] px-3 py-2.5 text-sm font-normal outline-none transition focus:bg-[#FCFBF8] dark:focus:bg-slate-950 focus:border-[#4A7C59] focus:ring-2 focus:ring-[#4A7C59]/20 dark:focus:ring-emerald-950 disabled:bg-[#E5E0D4] dark:disabled:bg-slate-800"
                placeholder="Ej.: Shopping Sarmiento, Resistencia"
                required
              />
            </label>
            {calculandoEstimacion && (
              <p className="text-xs font-medium text-[#4A7C59] dark:text-emerald-400" role="status">
                Calculando ruta y precio…
              </p>
            )}
            {puedeCancelar && <p className="text-xs text-amber-800 dark:text-amber-300">Terminá o cancelá el viaje activo antes de solicitar otro.</p>}
          </form>

          {estimacion && !viaje && (
            <section className="space-y-4 rounded-2xl border border-[#4A7C59]/30 dark:border-slate-700 bg-[#EFECE4] dark:bg-slate-900 p-5" aria-labelledby="titulo-precio">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="titulo-precio" className="text-xs font-bold uppercase tracking-wide text-[#4A7C59] dark:text-emerald-400">Precio estimado</h2>
                  <p className="mt-1 text-3xl font-extrabold tracking-tight text-[#2C2B28] dark:text-slate-100">{importePesos(estimacion.precio_estimado)}</p>
                  {modoDev && (
                    <p className="mt-1 text-xs text-[#5E5B54] dark:text-slate-300" data-testid="estimacion-meta-dev">{estimacion.zona} · regla v{estimacion.version_regla}</p>
                  )}
                </div>
                {modoDev && (
                  <span className="rounded-lg border border-[#4A7C59]/40 dark:border-amber-700 bg-[#F7F5F0] dark:bg-slate-800 px-2.5 py-1.5 text-sm font-extrabold text-[#4A7C59] dark:text-amber-300" data-testid="estimacion-multiplicador-dev">
                    ×{estimacion.multiplicador_demanda.toFixed(2)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800 p-3"><span className="block text-[#5E5B54] dark:text-slate-300">Distancia</span><strong className="mt-1 block text-[#2C2B28] dark:text-slate-100">{(estimacion.distancia_metros / 1000).toFixed(1)} km</strong></div>
                <div className="rounded-lg border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800 p-3"><span className="block text-[#5E5B54] dark:text-slate-300">Duración aprox.</span><strong className="mt-1 block text-[#2C2B28] dark:text-slate-100">{Math.max(1, Math.ceil(estimacion.duracion_segundos / 60))} min</strong></div>
              </div>

              {modoDev && (
                <div data-testid="estimacion-factores-dev">
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#4A7C59] dark:text-emerald-300">Factores del precio</h3>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    {camposFactor.map((campo) => (
                      <div key={campo.clave} className="rounded-lg border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800 p-2.5">
                        <dt className="text-[#5E5B54] dark:text-slate-300">{campo.etiqueta}</dt>
                        <dd className="mt-0.5 font-semibold capitalize text-[#2C2B28] dark:text-slate-100">{campo.mostrar(estimacion.factores_precio[campo.clave])}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${segundosVigencia > 0 ? "bg-[#F7F5F0] dark:bg-slate-800 text-[#4A7C59] dark:text-emerald-300 border border-[#DDD8CC] dark:border-slate-700" : "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300"}`} aria-live="polite">
                {segundosVigencia > 0 ? `Este precio vence en ${formatearTiempo(segundosVigencia)}` : "La estimación venció. Volvé a elegir destino para recalcular."}
              </div>
              <button type="button" onClick={() => void confirmarViaje()} disabled={procesando || calculandoEstimacion || segundosVigencia <= 0} className="w-full rounded-xl bg-[#4A7C59] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#3E6A4B] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50">
                {procesando ? "Confirmando…" : "Confirmar viaje"}
              </button>
            </section>
          )}

          {viaje && (
            <section className="space-y-4 rounded-2xl border border-[#4A7C59]/30 dark:border-emerald-900/50 bg-[#EFECE4] dark:bg-slate-900 p-5 shadow-sm" aria-labelledby="titulo-viaje-activo">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="titulo-viaje-activo" className="text-xs font-bold uppercase tracking-wide text-[#5E5B54] dark:text-slate-400">
                    {estadoViaje === "sin_choferes_disponibles" ? "Sin chofer disponible" : estadoViaje === "finalizado" ? "Viaje finalizado" : "Viaje confirmado"}
                  </h2>
                  <p className="mt-1 text-2xl font-extrabold text-[#2C2B28] dark:text-slate-100">{importePesos(viaje.precio_final ?? viaje.precio_estimado)}</p>
                </div>
                <InsigniaEstadoViaje estado={viaje.estado} />
              </div>
              <p className="text-xs text-[#5E5B54] dark:text-slate-400">El precio y sus factores se mantienen congelados desde la confirmación.</p>
              <button type="button" onClick={() => void cancelarViaje()} disabled={procesando || !puedeCancelar} className="w-full rounded-xl border border-red-300 dark:border-red-800/60 bg-[#F7F5F0] dark:bg-slate-900 px-4 py-2.5 text-sm font-bold text-red-700 dark:text-red-400 transition hover:bg-red-50 dark:hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-50">
                {procesando ? "Procesando…" : puedeCancelar ? "Cancelar viaje" : etiquetaEstado(viaje.estado)}
              </button>
            </section>
          )}

          {cobro && viaje && cobro.id_viaje === viaje.id_viaje && (
            <section className="space-y-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 p-5 shadow-sm" aria-labelledby="titulo-recibo-cobro" data-testid="recibo-cobro-pasajero">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="titulo-recibo-cobro" className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Recibo del viaje</h2>
                  <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Cobro #{cobro.id_cobro}</p>
                </div>
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/60 px-3 py-1 text-xs font-bold text-emerald-800 dark:text-emerald-200">
                  {cobro.estado === "confirmado" ? "Pago confirmado" : "Pago pendiente"}
                </span>
              </div>
              <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                Total a pagar por el viaje:
              </p>
              <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{importePesos(cobro.importe)}</p>
              <dl className="grid grid-cols-1 gap-2 text-xs">
                <div className="rounded-lg border border-white/80 dark:border-slate-800 bg-white/80 dark:bg-slate-800/80 p-3"><dt className="text-slate-500 dark:text-slate-400">Fecha</dt><dd className="mt-1 font-semibold text-slate-800 dark:text-slate-200">{new Date(cobro.creado_en).toLocaleString("es-AR")}</dd></div>
              </dl>
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                El cobro quedó confirmado por el importe final congelado al cerrar el viaje.
              </p>
            </section>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#DDD8CC] dark:border-slate-800 bg-[#EFECE4] dark:bg-slate-900 shadow-sm lg:sticky lg:top-24" aria-label="Recorrido estimado">
          <div className="flex flex-col justify-between gap-2 border-b border-[#DDD8CC] dark:border-slate-800 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-sm font-bold text-[#2C2B28] dark:text-slate-100">Recorrido</h2>
              <p className="mt-0.5 text-xs text-[#5E5B54] dark:text-slate-400">Tocá el mapa o arrastrá los pines para ajustar tu viaje.</p>
            </div>
            {estimacion && <span className="text-xs font-semibold text-[#5E5B54] dark:text-slate-300">{(estimacion.distancia_metros / 1000).toFixed(1)} km · {Math.ceil(estimacion.duracion_segundos / 60)} min</span>}
          </div>
          <div className="relative h-[440px] bg-[#E5E0D4] dark:bg-slate-950">
            <MapaLeaflet
              altura="440px"
              sinBorde
              origen={origenPinMapa}
              destino={destinoPinMapa}
              rutaGeoJson={rutaMapa}
              onSeleccionarPunto={puedeCancelar ? undefined : manejarPinArrastrado}
            />
            {!estimacion && !viaje && (
              <div className="pointer-events-none absolute top-3 left-3 right-3 sm:right-auto z-[400] rounded-lg border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0]/95 dark:bg-slate-900/95 px-3 py-2 text-xs text-[#2C2B28] dark:text-slate-200 shadow-xs">
                Elegí un destino escribiendo la dirección o tocando el mapa para calcular el precio automáticamente.
              </div>
            )}
            {estimacion && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-3 py-1.5 text-[11px] font-semibold shadow-xs">
                <span className="inline-flex items-center gap-1.5 text-blue-700 dark:text-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400" aria-hidden="true" />
                  Origen
                </span>
                <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-600 dark:bg-red-400" aria-hidden="true" />
                  Destino
                </span>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
};
