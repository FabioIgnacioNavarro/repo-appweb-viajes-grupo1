import React, { useCallback, useEffect, useRef, useState } from "react";
import { clienteApi, ErrorHttpApi, generarClaveIdempotencia } from "../../nucleo/api";
import { obtenerSesion } from "../../nucleo/sesion";
import { clienteTiempoReal } from "../../nucleo/ws";

interface Coordenada {
  latitud: number;
  longitud: number;
}

interface EstimacionDto {
  id_estimacion: string;
  precio_estimado: string;
  moneda: "ARS";
  distancia_metros: number;
  duracion_segundos: number;
  multiplicador_demanda: number;
  zona: string;
  factores_precio: Record<string, unknown>;
  version_regla: number;
  creada_en: string;
  vigente_hasta: string;
  origen: Coordenada;
  destino: Coordenada;
  polilinea: string | null;
}

interface ViajeDto {
  id_viaje: string;
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
  if (!estimacion.polilinea) return [estimacion.origen, estimacion.destino];
  const opciones = [5, 6].flatMap((precision) => {
    try {
      const puntos = decodificarPolilinea(estimacion.polilinea!, precision);
      if (puntos.length < 2) return [];
      const errorExtremos = (a: Coordenada, b: Coordenada) => Math.abs(a.latitud - b.latitud) + Math.abs(a.longitud - b.longitud);
      const normal = errorExtremos(puntos[0], estimacion.origen) + errorExtremos(puntos[puntos.length - 1], estimacion.destino);
      const inversa = errorExtremos(puntos[0], estimacion.destino) + errorExtremos(puntos[puntos.length - 1], estimacion.origen);
      return [{ puntos: inversa < normal ? [...puntos].reverse() : puntos, error: Math.min(normal, inversa) }];
    } catch {
      return [];
    }
  });
  return opciones.sort((a, b) => a.error - b.error)[0]?.puntos ?? [estimacion.origen, estimacion.destino];
}

function puntosSvg(puntos: Coordenada[]): string {
  const longitudes = puntos.map((punto) => punto.longitud);
  const latitudes = puntos.map((punto) => punto.latitud);
  const minLongitud = Math.min(...longitudes);
  const maxLongitud = Math.max(...longitudes);
  const minLatitud = Math.min(...latitudes);
  const maxLatitud = Math.max(...latitudes);
  const ancho = maxLongitud - minLongitud || 0.001;
  const alto = maxLatitud - minLatitud || 0.001;
  const margen = 48;
  const anchoVista = 640 - margen * 2;
  const altoVista = 360 - margen * 2;
  const escala = Math.min(anchoVista / ancho, altoVista / alto);
  const dibujadoAncho = ancho * escala;
  const dibujadoAlto = alto * escala;
  const desplazamientoX = (640 - dibujadoAncho) / 2;
  const desplazamientoY = (360 - dibujadoAlto) / 2;

  return puntos.map((punto) => {
    const x = desplazamientoX + (punto.longitud - minLongitud) * escala;
    const y = 360 - desplazamientoY - (punto.latitud - minLatitud) * escala;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
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

export const VistaPasajero: React.FC = () => {
  const sesion = obtenerSesion();
  const [origen, setOrigen] = useState("Plaza 25 de Mayo, Resistencia");
  const [destino, setDestino] = useState("Av. Sarmiento y Ruta 16, Resistencia");
  const [estimacion, setEstimacion] = useState<EstimacionDto | null>(null);
  const [viaje, setViaje] = useState<ViajeDto | null>(null);
  const [cobro, setCobro] = useState<CobroDto | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<ErrorVisible | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const claveConfirmacion = useRef<string | null>(null);
  const claveReintentoCobro = useRef<{ viajeId: string; valor: string } | null>(null);
  const bloqueoEnvio = useRef(false);
  const viajeActualRef = useRef<ViajeDto | null>(null);

  useEffect(() => {
    viajeActualRef.current = viaje;
  }, [viaje]);

  const sincronizarViajeActivo = useCallback(async () => {
    try {
      const respuesta = await clienteApi.get<DatosViajes>("/viajes");
      const ordenados = respuesta.viajes
        .sort((a, b) => Date.parse(b.creado_en) - Date.parse(a.creado_en));
      const activo = ordenados
        .filter((elemento) => ESTADOS_ACTIVOS.has(elemento.estado.toLowerCase()))
        [0];
      const ultimoFinalizado = ordenados.find((elemento) => elemento.estado.toLowerCase() === "finalizado");
      const viajeMostrable = activo ?? ultimoFinalizado ?? null;
      setViaje(viajeMostrable);
      if (viajeMostrable?.estado.toLowerCase() === "finalizado") {
        try {
          const recibo = await clienteApi.get<CobroDto>(`/viajes/${encodeURIComponent(viajeMostrable.id_viaje)}/cobro`);
          setCobro(recibo);
        } catch {
          setCobro(null);
        }
      } else {
        setCobro(null);
      }
    } catch {
      // La vista conserva el estado visible si el backend no está disponible temporalmente.
    }
  }, []);

  useEffect(() => {
    if (sesion?.rol !== "PASAJERO") return;
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
  const puntos = estimacion ? puntosDeRuta(estimacion) : [];
  const rutaDibujada = puntos.length > 1 ? puntosSvg(puntos) : "";
  const puntosRutaDibujada = rutaDibujada.split(" ").map((punto) => punto.split(","));
  const puntoInicial = puntosRutaDibujada[0];
  const puntoFinal = puntosRutaDibujada[puntosRutaDibujada.length - 1];
  const estadoViaje = viaje?.estado.toLowerCase() ?? "";
  const puedeCancelar = Boolean(viaje && ESTADOS_CANCELABLES_PASAJERO.has(estadoViaje));

  const invalidarEstimacion = () => {
    setEstimacion(null);
    claveConfirmacion.current = null;
    setError(null);
    setAviso(null);
  };

  const solicitarEstimacion = async (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (!origen.trim() || !destino.trim()) {
      setError({ codigo: "ENTRADA_INVALIDA", mensaje: "Completá el origen y el destino para calcular el precio." });
      return;
    }
    if (bloqueoEnvio.current) return;
    bloqueoEnvio.current = true;
    setProcesando(true);
    setError(null);
    setAviso(null);
    try {
      const respuesta = await clienteApi.post<EstimacionDto>("/viajes/estimacion", {
        origen: { direccion: origen.trim() },
        destino: { direccion: destino.trim() }
      });
      setEstimacion(respuesta);
      claveConfirmacion.current = null;
      claveReintentoCobro.current = null;
      setCobro(null);
      setViaje(null);
      setAviso("Precio calculado. Se mantiene vigente durante tres minutos.");
    } catch (causa) {
      setError(errorVisible(causa, "ESTIMACION_NO_DISPONIBLE", "No se pudo calcular el precio. Revisá las direcciones e intentá nuevamente."));
    } finally {
      bloqueoEnvio.current = false;
      setProcesando(false);
    }
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

  const reintentarCobro = async () => {
    if (!viaje || !cobro || cobro.estado !== "fallido" || bloqueoEnvio.current) return;
    bloqueoEnvio.current = true;
    setProcesando(true);
    setError(null);
    setAviso(null);
    const previo = claveReintentoCobro.current;
    const clave = previo?.viajeId === viaje.id_viaje ? previo.valor : generarClaveIdempotencia();
    claveReintentoCobro.current = { viajeId: viaje.id_viaje, valor: clave };
    try {
      const actualizado = await clienteApi.post<CobroDto>(
        `/viajes/${encodeURIComponent(viaje.id_viaje)}/cobro/reintento`,
        {},
        { claveIdempotencia: clave }
      );
      setCobro(actualizado);
      claveReintentoCobro.current = null;
      setAviso(actualizado.estado === "confirmado"
        ? "El pago se confirmó. El recibo conserva el precio final del viaje."
        : "El intento volvió a fallar. Podés volver a intentarlo; no se generará otro cobro.");
    } catch (causa) {
      setError(errorVisible(causa, "COBRO_NO_DISPONIBLE", "No se pudo consultar el resultado del pago. Reintentá con seguridad."));
    } finally {
      bloqueoEnvio.current = false;
      setProcesando(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6" aria-labelledby="titulo-pasajero">
      <header className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:p-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Panel de pasajero</p>
          <h1 id="titulo-pasajero" className="mt-1 text-2xl font-extrabold text-slate-900">Hola, {sesion?.nombre || "Pasajero"}</h1>
          <p className="mt-1 text-sm text-slate-500">Cotizá tu recorrido y confirmá el precio antes de pedir el viaje.</p>
        </div>
        <span className="w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Variante A · precio dinámico</span>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>{error.codigo}:</strong> {error.mensaje}
        </div>
      )}
      {aviso && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-5">
          <form onSubmit={solicitarEstimacion} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Calcular estimación del viaje">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Tu recorrido</h2>
              <p className="mt-1 text-xs text-slate-500">Ingresá una dirección en Resistencia o alrededores.</p>
            </div>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="origen-viaje">
              Origen
              <input id="origen-viaje" name="origen" autoComplete="street-address" value={origen} onChange={(evento) => { setOrigen(evento.target.value); invalidarEstimacion(); }} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder="Plaza 25 de Mayo, Resistencia" required />
            </label>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="destino-viaje">
              Destino
              <input id="destino-viaje" name="destino" autoComplete="street-address" value={destino} onChange={(evento) => { setDestino(evento.target.value); invalidarEstimacion(); }} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder="Av. Sarmiento y Ruta 16, Resistencia" required />
            </label>
            <button type="submit" disabled={procesando || puedeCancelar} className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
              {procesando ? "Calculando…" : "Calcular precio"}
            </button>
            {puedeCancelar && <p className="text-xs text-amber-700">Terminá o cancelá el viaje activo antes de solicitar otro.</p>}
          </form>

          {estimacion && !viaje && (
            <section className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-5" aria-labelledby="titulo-precio">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="titulo-precio" className="text-xs font-bold uppercase tracking-wide text-amber-900">Precio estimado</h2>
                  <p className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">{importePesos(estimacion.precio_estimado)}</p>
                  <p className="mt-1 text-xs text-slate-600">{estimacion.zona} · regla v{estimacion.version_regla}</p>
                </div>
                <span className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm font-extrabold text-amber-900">×{estimacion.multiplicador_demanda.toFixed(2)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-amber-200 bg-white p-3"><span className="block text-slate-500">Distancia</span><strong className="mt-1 block text-slate-900">{(estimacion.distancia_metros / 1000).toFixed(1)} km</strong></div>
                <div className="rounded-lg border border-amber-200 bg-white p-3"><span className="block text-slate-500">Duración aprox.</span><strong className="mt-1 block text-slate-900">{Math.max(1, Math.ceil(estimacion.duracion_segundos / 60))} min</strong></div>
              </div>

              <div>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-900">Factores del precio</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  {camposFactor.map((campo) => (
                    <div key={campo.clave} className="rounded-lg border border-amber-100 bg-white/80 p-2.5">
                      <dt className="text-slate-500">{campo.etiqueta}</dt>
                      <dd className="mt-0.5 font-semibold capitalize text-slate-900">{campo.mostrar(estimacion.factores_precio[campo.clave])}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${segundosVigencia > 0 ? "bg-white text-indigo-700" : "bg-red-100 text-red-800"}`} aria-live="polite">
                {segundosVigencia > 0 ? `Este precio vence en ${formatearTiempo(segundosVigencia)}` : "La estimación venció. Calculá el precio otra vez."}
              </div>
              <button type="button" onClick={() => void confirmarViaje()} disabled={procesando || segundosVigencia <= 0} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                {procesando ? "Confirmando…" : "Confirmar viaje y congelar precio"}
              </button>
            </section>
          )}

          {viaje && (
            <section className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm" aria-labelledby="titulo-viaje-activo">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="titulo-viaje-activo" className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {estadoViaje === "sin_choferes_disponibles" ? "Sin chofer disponible" : estadoViaje === "finalizado" ? "Viaje finalizado" : "Viaje confirmado"}
                  </h2>
                  <p className="mt-1 text-2xl font-extrabold text-slate-900">{importePesos(viaje.precio_final ?? viaje.precio_estimado)}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">{etiquetaEstado(viaje.estado)}</span>
              </div>
              <p className="text-xs text-slate-600">El precio y sus factores se mantienen congelados desde la confirmación.</p>
              <button type="button" onClick={() => void cancelarViaje()} disabled={procesando || !puedeCancelar} className="w-full rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                {procesando ? "Procesando…" : puedeCancelar ? "Cancelar viaje" : etiquetaEstado(viaje.estado)}
              </button>
            </section>
          )}

          {cobro && viaje && cobro.id_viaje === viaje.id_viaje && (
            <section className={`space-y-3 rounded-2xl border p-5 shadow-sm ${cobro.estado === "confirmado" ? "border-emerald-200 bg-emerald-50" : cobro.estado === "fallido" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`} aria-labelledby="titulo-recibo-cobro">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="titulo-recibo-cobro" className="text-xs font-bold uppercase tracking-wide text-slate-600">Recibo del viaje</h2>
                  <p className="mt-1 text-xs font-semibold text-slate-700">Cobro #{cobro.id_cobro}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${cobro.estado === "confirmado" ? "bg-emerald-100 text-emerald-800" : cobro.estado === "fallido" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                  {cobro.estado === "confirmado" ? "Pago confirmado" : cobro.estado === "fallido" ? "Pago fallido" : "Pago pendiente"}
                </span>
              </div>
              <p className="text-2xl font-extrabold text-slate-900">{importePesos(cobro.importe)}</p>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-white/80 bg-white/80 p-3"><dt className="text-slate-500">Intentos</dt><dd className="mt-1 font-semibold text-slate-800">{cobro.intentos}</dd></div>
                <div className="rounded-lg border border-white/80 bg-white/80 p-3"><dt className="text-slate-500">Fecha</dt><dd className="mt-1 font-semibold text-slate-800">{new Date(cobro.creado_en).toLocaleString("es-AR")}</dd></div>
              </dl>
              {cobro.estado === "fallido" && (
                <>
                  <p className="text-xs text-rose-800">El viaje se completó, pero el pago no se confirmó. Podés reintentar; el importe y el cobro se mantienen únicos.</p>
                  <button type="button" onClick={() => void reintentarCobro()} disabled={procesando} className="w-full rounded-xl bg-rose-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50">
                    {procesando ? "Reintentando pago…" : "Reintentar pago"}
                  </button>
                </>
              )}
              {cobro.estado === "confirmado" && <p className="text-xs font-semibold text-emerald-800">El cobro quedó confirmado por el importe final congelado al cerrar el viaje.</p>}
            </section>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Recorrido estimado">
          <div className="flex flex-col justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Recorrido</h2>
              <p className="mt-0.5 text-xs text-slate-500">La línea sigue la geometría devuelta por el proveedor de rutas.</p>
            </div>
            {estimacion && <span className="text-xs font-semibold text-slate-600">{(estimacion.distancia_metros / 1000).toFixed(1)} km · {Math.ceil(estimacion.duracion_segundos / 60)} min</span>}
          </div>
          <div className="relative min-h-[320px] bg-slate-100 sm:min-h-[440px]">
            {estimacion ? (
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 640 360" role="img" aria-label={`Ruta estimada desde latitud ${estimacion.origen.latitud} hasta latitud ${estimacion.destino.latitud}`} preserveAspectRatio="xMidYMid meet">
                <defs>
                  <pattern id="cuadricula-mapa-pasajero" width="32" height="32" patternUnits="userSpaceOnUse">
                    <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#dbe4e7" strokeWidth="1" />
                  </pattern>
                  <filter id="sombra-ruta-pasajero" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
                </defs>
                <rect width="640" height="360" fill="#eef3f2" />
                <rect width="640" height="360" fill="url(#cuadricula-mapa-pasajero)" />
                {rutaDibujada && <>
                  <polyline points={rutaDibujada} fill="none" stroke="#0f766e" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" opacity="0.16" filter="url(#sombra-ruta-pasajero)" />
                  <polyline points={rutaDibujada} fill="none" stroke="#0f766e" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx={puntoInicial?.[0]} cy={puntoInicial?.[1]} r="12" fill="#059669" stroke="white" strokeWidth="5" />
                  <circle cx={puntoFinal?.[0]} cy={puntoFinal?.[1]} r="12" fill="#ea580c" stroke="white" strokeWidth="5" />
                </>}
                {!rutaDibujada && <text x="320" y="180" textAnchor="middle" fill="#64748b" fontSize="16">Calculá una estimación para ver el recorrido</text>}
              </svg>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center text-slate-500">
                <span aria-hidden="true" className="text-4xl">⌖</span>
                <p className="mt-2 text-sm font-semibold text-slate-700">Tu recorrido va a aparecer acá</p>
                <p className="mt-1 max-w-sm text-xs">Ingresá origen y destino para calcular una ruta y conocer la tarifa antes de confirmar.</p>
              </div>
            )}
            {estimacion && <div className="absolute bottom-3 left-3 flex gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] font-semibold shadow-sm">
              <span className="text-emerald-700">● Origen</span><span className="text-orange-700">● Destino</span>
            </div>}
          </div>
        </section>
      </div>
    </main>
  );
};
