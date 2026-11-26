import React, { useCallback, useEffect, useState } from "react";
import { clienteApi, ErrorHttpApi } from "../../nucleo/api";
import { useRouter } from "../../nucleo/router";
import {
  Boton,
  CampoTexto,
  IconoAdmin,
  IconoRayo,
  TablaResponsiva,
  Tarjeta,
  Toast,
  type ColumnaTabla,
} from "../../componentes/comunes";

interface TramoUmbralDto {
  hasta: number | null;
  multiplicador: number;
}

type FranjaHoraria = "MADRUGADA" | "MANANA" | "SIESTA" | "TARDE" | "NOCHE";

interface ReglaDemandaDto {
  version: number;
  autor: string;
  creada_en: string;
  activa: boolean;
  tarifa_base_pesos: string;
  precio_por_kilometro_pesos: string;
  precio_por_minuto_pesos: string;
  multiplicador_minimo: number;
  multiplicador_maximo: number;
  lluvia_con_precipitacion: number;
  lluvia_sin_precipitacion: number;
  disponibilidad: TramoUmbralDto[];
  demanda_por_mil: TramoUmbralDto[];
  horario: Record<FranjaHoraria, number>;
}

interface RespuestaReglasDto {
  activa: ReglaDemandaDto;
  historial: ReglaDemandaDto[];
}

interface VehiculoFlotaDto {
  id: string;
  patente: string;
  tipo_vehiculo: string;
  marca: string;
  modelo: string;
  anio_fabricacion: number;
  color: string;
  capacidad_pasajeros: number;
  estado: "ACTIVO" | "INACTIVO";
}

interface ChoferFlotaDto {
  id: string;
  usuario_id: string;
  habilitado: boolean;
  disponibilidad: boolean;
  carnet_conducir_validado: boolean;
  vehiculo_activo: VehiculoFlotaDto | null;
}

interface EstadoServicio {
  nombre: string;
  estado: "listo" | "degradado" | "verificando";
}

const ETIQUETAS_FRANJA: Record<FranjaHoraria, string> = {
  MADRUGADA: "Madrugada (00-06h)",
  MANANA: "Mañana (06-12h)",
  SIESTA: "Siesta (12-16h)",
  TARDE: "Tarde (16-20h)",
  NOCHE: "Noche (20-24h)",
};

const SERVICIOS_READY = [
  { nombre: "ms-viajes", ruta: "/ready/viajes" },
  { nombre: "ms-tarifas", ruta: "/ready/tarifas" },
  { nombre: "ms-flota", ruta: "/ready/flota" },
];

function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (!Number.isFinite(fecha.getTime())) return iso;
  return fecha.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function resumirCurva(tramos: TramoUmbralDto[]): string {
  return tramos
    .map((t) => `${t.hasta === null ? "∞" : `≤${t.hasta}`}: ${t.multiplicador.toFixed(2)}x`)
    .join(" · ");
}

function importePesos(importe: string): string {
  const digitos = importe.replace(/\D/g, "");
  return `$ ${digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ARS`;
}

export const VistaAdmin: React.FC = () => {
  const { navegarA } = useRouter();

  const [salud, setSalud] = useState<EstadoServicio[]>(
    SERVICIOS_READY.map((s) => ({ nombre: s.nombre, estado: "verificando" }))
  );

  const [activa, setActiva] = useState<ReglaDemandaDto | null>(null);
  const [historial, setHistorial] = useState<ReglaDemandaDto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorPanel, setErrorPanel] = useState<string | null>(null);
  const [toast, setToast] = useState<{ mensaje: string; tipo: "exito" | "error" | "info" } | null>(null);

  // Estado editable del formulario (solo parámetros de política dinámica)
  const [minMult, setMinMult] = useState("0.75");
  const [maxMult, setMaxMult] = useState("2");
  const [lluviaCon, setLluviaCon] = useState("1.1");
  const [lluviaSin, setLluviaSin] = useState("1");
  const [horario, setHorario] = useState<Record<FranjaHoraria, string>>({
    MADRUGADA: "1",
    MANANA: "1",
    SIESTA: "0.95",
    TARDE: "1.05",
    NOCHE: "1.1",
  });
  const [demandaPorMil, setDemandaPorMil] = useState<Array<{ hasta: string; multiplicador: string; abierto: boolean }>>([]);
  const [disponibilidad, setDisponibilidad] = useState<Array<{ hasta: string; multiplicador: string; abierto: boolean }>>([]);

  // Estado de Gestión de Flota (choferes, habilitación y vehículos en ms-flota)
  const [choferesFlota, setChoferesFlota] = useState<ChoferFlotaDto[]>([]);
  const [vehiculosFlota, setVehiculosFlota] = useState<VehiculoFlotaDto[]>([]);
  const [nuevoChoferId, setNuevoChoferId] = useState("");
  const [patente, setPatente] = useState("");
  const [tipoVehiculo, setTipoVehiculo] = useState("AUTOMOVIL");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anioVehiculo, setAnioVehiculo] = useState("2024");
  const [colorVehiculo, setColorVehiculo] = useState("");
  const [capacidadVehiculo, setCapacidadVehiculo] = useState("4");
  const [vehiculoSeleccionadoPorChofer, setVehiculoSeleccionadoPorChofer] = useState<Record<string, string>>({});
  const [cargandoFlota, setCargandoFlota] = useState(false);

  const aplicarReglaAlFormulario = useCallback((regla: ReglaDemandaDto) => {
    setMinMult(String(regla.multiplicador_minimo));
    setMaxMult(String(regla.multiplicador_maximo));
    setLluviaCon(String(regla.lluvia_con_precipitacion));
    setLluviaSin(String(regla.lluvia_sin_precipitacion));
    setHorario({
      MADRUGADA: String(regla.horario.MADRUGADA),
      MANANA: String(regla.horario.MANANA),
      SIESTA: String(regla.horario.SIESTA),
      TARDE: String(regla.horario.TARDE),
      NOCHE: String(regla.horario.NOCHE),
    });
    setDemandaPorMil(
      regla.demanda_por_mil.map((t) => ({
        hasta: t.hasta === null ? "" : String(t.hasta),
        multiplicador: String(t.multiplicador),
        abierto: t.hasta === null,
      }))
    );
    setDisponibilidad(
      regla.disponibilidad.map((t) => ({
        hasta: t.hasta === null ? "" : String(t.hasta),
        multiplicador: String(t.multiplicador),
        abierto: t.hasta === null,
      }))
    );
  }, []);

  const verificarSalud = useCallback(async () => {
    const resultados = await Promise.all(
      SERVICIOS_READY.map(async (s): Promise<EstadoServicio> => {
        try {
          const res = await clienteApi.get<{ estado?: string }>(s.ruta, { sinToken: true });
          return { nombre: s.nombre, estado: res?.estado === "listo" ? "listo" : "degradado" };
        } catch {
          return { nombre: s.nombre, estado: "degradado" };
        }
      })
    );
    setSalud(resultados);
  }, []);

  const cargarReglas = useCallback(async () => {
    setCargando(true);
    setErrorPanel(null);
    try {
      const res = await clienteApi.get<RespuestaReglasDto>("/reglas/demanda");
      if (!res || typeof res !== "object" || !res.activa || !Array.isArray(res.historial)) {
        setActiva(null);
        setHistorial([]);
        setErrorPanel("Servicio ms-tarifas no disponible o respuesta inválida al consultar /reglas/demanda.");
        return;
      }
      setActiva(res.activa);
      setHistorial(res.historial);
      aplicarReglaAlFormulario(res.activa);
    } catch (err) {
      const msg = err instanceof ErrorHttpApi ? `${err.codigo}: ${err.mensaje}` : "No se pudo consultar la regla de demanda.";
      setErrorPanel(msg);
    } finally {
      setCargando(false);
    }
  }, [aplicarReglaAlFormulario]);

  const cargarFlota = useCallback(async () => {
    setCargandoFlota(true);
    try {
      const [resChoferes, resVehiculos] = await Promise.all([
        clienteApi.get<{ choferes?: ChoferFlotaDto[] }>("/choferes").catch(() => null),
        clienteApi.get<{ vehiculos?: VehiculoFlotaDto[] }>("/vehiculos").catch(() => null),
      ]);
      if (Array.isArray(resChoferes?.choferes)) setChoferesFlota(resChoferes.choferes);
      if (Array.isArray(resVehiculos?.vehiculos)) setVehiculosFlota(resVehiculos.vehiculos);
    } finally {
      setCargandoFlota(false);
    }
  }, []);

  useEffect(() => {
    void verificarSalud();
    void cargarReglas();
    void cargarFlota();
  }, [verificarSalud, cargarReglas, cargarFlota]);

  const registrarChoferAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoChoferId.trim()) return;
    setCargandoFlota(true);
    try {
      await clienteApi.post("/choferes", {
        usuario_id: nuevoChoferId.trim(),
        habilitado: false,
        carnet_conducir_validado: true,
      });
      setNuevoChoferId("");
      await cargarFlota();
      setToast({ mensaje: "Perfil de chofer registrado (pendiente de habilitación).", tipo: "exito" });
    } catch (err) {
      const msg = err instanceof ErrorHttpApi ? `${err.codigo}: ${err.mensaje}` : "No se pudo registrar el chofer.";
      setToast({ mensaje: msg, tipo: "error" });
    } finally {
      setCargandoFlota(false);
    }
  };

  const alternarHabilitacionChofer = async (chofer: ChoferFlotaDto) => {
    setCargandoFlota(true);
    try {
      await clienteApi.patch(`/choferes/${encodeURIComponent(chofer.usuario_id)}/habilitacion`, {
        habilitado: !chofer.habilitado,
        carnet_conducir_validado: true,
      });
      await cargarFlota();
      setToast({
        mensaje: !chofer.habilitado ? "Chofer habilitado para operar." : "Chofer inhabilitado.",
        tipo: "exito",
      });
    } catch (err) {
      const msg = err instanceof ErrorHttpApi ? `${err.codigo}: ${err.mensaje}` : "No se pudo actualizar la habilitación.";
      setToast({ mensaje: msg, tipo: "error" });
    } finally {
      setCargandoFlota(false);
    }
  };

  const registrarVehiculoAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargandoFlota(true);
    try {
      await clienteApi.post("/vehiculos", {
        patente,
        tipo_vehiculo: tipoVehiculo,
        marca,
        modelo,
        anio_fabricacion: Number(anioVehiculo),
        color: colorVehiculo,
        capacidad_pasajeros: Number(capacidadVehiculo),
      });
      setPatente("");
      setMarca("");
      setModelo("");
      setColorVehiculo("");
      await cargarFlota();
      setToast({ mensaje: "Vehículo registrado en flota.", tipo: "exito" });
    } catch (err) {
      const msg = err instanceof ErrorHttpApi ? `${err.codigo}: ${err.mensaje}` : "No se pudo registrar el vehículo.";
      setToast({ mensaje: msg, tipo: "error" });
    } finally {
      setCargandoFlota(false);
    }
  };

  const asignarVehiculo = async (usuarioId: string) => {
    const idVehiculo = vehiculoSeleccionadoPorChofer[usuarioId] || vehiculosFlota[0]?.id;
    if (!idVehiculo) return;
    setCargandoFlota(true);
    try {
      await clienteApi.put(`/choferes/${encodeURIComponent(usuarioId)}/vehiculo`, { id_vehiculo: idVehiculo });
      await cargarFlota();
      setToast({ mensaje: "Vehículo asignado al chofer.", tipo: "exito" });
    } catch (err) {
      const msg = err instanceof ErrorHttpApi ? `${err.codigo}: ${err.mensaje}` : "No se pudo asignar el vehículo.";
      setToast({ mensaje: msg, tipo: "error" });
    } finally {
      setCargandoFlota(false);
    }
  };

  const actualizarTramoDemanda = (idx: number, campo: "hasta" | "multiplicador", valor: string) => {
    setDemandaPorMil((prev) => prev.map((item, i) => (i === idx ? { ...item, [campo]: valor } : item)));
  };

  const agregarTramoDemanda = () => {
    setDemandaPorMil((prev) => {
      if (prev.length === 0) return [{ hasta: "", multiplicador: "1", abierto: true }];
      const ultimo = prev[prev.length - 1]!;
      const previoHasta = prev.length >= 2 ? Number(prev[prev.length - 2]!.hasta || 0) : 0;
      const nuevoUmbral = String(previoHasta + 1000);
      return [
        ...prev.slice(0, -1),
        { hasta: nuevoUmbral, multiplicador: ultimo.multiplicador, abierto: false },
        ultimo,
      ];
    });
  };

  const quitarTramoDemanda = (idx: number) => {
    setDemandaPorMil((prev) => (prev.length <= 1 || idx === prev.length - 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const enviarNuevaVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setErrorPanel(null);

    try {
      const payload = {
        multiplicador_minimo: Number(minMult),
        multiplicador_maximo: Number(maxMult),
        lluvia_con_precipitacion: Number(lluviaCon),
        lluvia_sin_precipitacion: Number(lluviaSin),
        disponibilidad: disponibilidad.map((t) => ({
          hasta: t.abierto ? null : Number(t.hasta),
          multiplicador: Number(t.multiplicador),
        })),
        demanda_por_mil: demandaPorMil.map((t) => ({
          hasta: t.abierto ? null : Number(t.hasta),
          multiplicador: Number(t.multiplicador),
        })),
        horario: {
          MADRUGADA: Number(horario.MADRUGADA),
          MANANA: Number(horario.MANANA),
          SIESTA: Number(horario.SIESTA),
          TARDE: Number(horario.TARDE),
          NOCHE: Number(horario.NOCHE),
        },
      };

      const res = await clienteApi.put<RespuestaReglasDto>("/reglas/demanda", payload);
      if (!res || typeof res !== "object" || !res.activa || !Array.isArray(res.historial)) {
        throw new Error("Respuesta inválida del servidor al publicar la regla.");
      }
      setActiva(res.activa);
      setHistorial(res.historial);
      aplicarReglaAlFormulario(res.activa);
      setToast({
        mensaje: `Regla v${res.activa.version} publicada por ${res.activa.autor}.`,
        tipo: "exito",
      });
    } catch (err) {
      const msg = err instanceof ErrorHttpApi ? `${err.codigo}: ${err.mensaje}` : "No se pudo guardar la nueva versión.";
      setErrorPanel(msg);
      setToast({ mensaje: msg, tipo: "error" });
    } finally {
      setGuardando(false);
    }
  };

  const columnasHistorial: ColumnaTabla<ReglaDemandaDto>[] = [
    {
      clave: "version",
      encabezado: "Versión",
      renderizar: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">v{r.version}</span>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
              r.activa
                ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
            }`}
          >
            {r.activa ? "Activa" : "Histórica"}
          </span>
        </div>
      ),
    },
    {
      clave: "autor",
      encabezado: "Autor (JWT)",
      renderizar: (r) => <span className="font-mono text-xs text-slate-800 dark:text-slate-200">{r.autor}</span>,
    },
    {
      clave: "creada_en",
      encabezado: "Fecha servidor",
      renderizar: (r) => <span className="text-xs text-slate-600 dark:text-slate-400">{formatearFecha(r.creada_en)}</span>,
    },
    {
      clave: "limites",
      encabezado: "Límites",
      renderizar: (r) => (
        <span className="font-mono text-xs text-[#2C2B28] dark:text-slate-200">
          {r.multiplicador_minimo.toFixed(2)}x – {r.multiplicador_maximo.toFixed(2)}x
        </span>
      ),
    },
    {
      clave: "demanda",
      encabezado: "Curva demanda",
      ocultarEnMovil: true,
      renderizar: (r) => <span className="text-xs text-[#5E5B54] dark:text-slate-400">{resumirCurva(r.demanda_por_mil)}</span>,
    },
    {
      clave: "accion",
      encabezado: "Editor",
      alinearDerecha: true,
      renderizar: (r) => (
        <Boton
          variante="secundario"
          tamano="sm"
          onClick={() => {
            aplicarReglaAlFormulario(r);
            setToast({ mensaje: `Parámetros de v${r.version} cargados en el editor.`, tipo: "info" });
          }}
        >
          Cargar en editor
        </Boton>
      ),
    },
  ];

  return (
    <section className="space-y-6" data-testid="vista-admin">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shrink-0">
            <IconoAdmin className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
              Configuración Global y Reglas de Tarifa
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              Administración versionada de la política de tarifas en <code className="font-mono">ms-tarifas</code>.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" onClick={() => navegarA("operador")}>
            Supervisión de viajes
          </Boton>
          <Boton variante="secundario" onClick={() => void cargarReglas()} cargando={cargando}>
            Recargar regla
          </Boton>
        </div>
      </div>

      {/* Estado de microservicios y resumen de regla vigente */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Tarjeta titulo="Estado de los microservicios (/ready)">
          <div className="flex flex-wrap gap-2.5">
            {salud.map((s) => (
              <div
                key={s.nombre}
                className="flex items-center gap-2 rounded-lg border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800 px-3 py-2 text-xs"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    s.estado === "listo"
                      ? "bg-[#4A7C59]"
                      : s.estado === "verificando"
                        ? "bg-amber-500"
                        : "bg-slate-400"
                  }`}
                />
                <span className="font-mono font-semibold text-[#2C2B28] dark:text-slate-100">{s.nombre}</span>
                <span className="text-[#5E5B54] dark:text-slate-300 capitalize">{s.estado}</span>
              </div>
            ))}
          </div>
        </Tarjeta>

        <Tarjeta titulo="Regla activa en producción">
          {activa ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs" data-testid="admin-regla-activa">
              <div>
                <p className="text-[#5E5B54] dark:text-slate-400">Versión activa</p>
                <p className="font-mono text-base font-bold text-[#2C2B28] dark:text-slate-100">v{activa.version}</p>
              </div>
              <div>
                <p className="text-[#5E5B54] dark:text-slate-400">Autor</p>
                <p className="font-mono font-semibold text-[#2C2B28] dark:text-slate-100 truncate" title={activa.autor}>
                  {activa.autor}
                </p>
              </div>
              <div>
                <p className="text-[#5E5B54] dark:text-slate-400">Publicada</p>
                <p className="font-semibold text-[#2C2B28] dark:text-slate-100">{formatearFecha(activa.creada_en)}</p>
              </div>
              <div className="col-span-2 sm:col-span-3 border-t border-[#DDD8CC] dark:border-slate-800 pt-2 text-[#5E5B54] dark:text-slate-300">
                Tarifas base inmutables aquí:{" "}
                <strong className="text-[#2C2B28] dark:text-slate-100">{importePesos(activa.tarifa_base_pesos)}</strong> bajada ·{" "}
                <strong className="text-[#2C2B28] dark:text-slate-100">{importePesos(activa.precio_por_kilometro_pesos)}</strong>/km ·{" "}
                <strong className="text-[#2C2B28] dark:text-slate-100">{importePesos(activa.precio_por_minuto_pesos)}</strong>/min
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#5E5B54] dark:text-slate-400">{cargando ? "Cargando regla activa..." : "Sin regla cargada."}</p>
          )}
        </Tarjeta>
      </div>

      {errorPanel && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs sm:text-sm text-red-900">
          {errorPanel}
        </div>
      )}

      {/* Editor de la nueva versión de regla */}
      <Tarjeta
        titulo={
          <span className="inline-flex items-center gap-2">
            <IconoRayo className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Regla de tarifa
          </span>
        }
        subtitulo="Fórmula auditada en ADR 0021: factor_total = limitar(lluvia × disponibilidad × demanda × horario, min, max). Cada cambio crea una versión nueva."
      >
        <form onSubmit={enviarNuevaVersion} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <CampoTexto
              id="regla-min-mult"
              etiqueta="Multiplicador mínimo"
              type="number"
              step="0.05"
              min="0.5"
              max="5"
              required
              value={minMult}
              onChange={(e) => setMinMult(e.target.value)}
            />
            <CampoTexto
              id="regla-max-mult"
              etiqueta="Multiplicador máximo"
              type="number"
              step="0.05"
              min="0.5"
              max="5"
              required
              value={maxMult}
              onChange={(e) => setMaxMult(e.target.value)}
            />
            <CampoTexto
              id="regla-lluvia-con"
              etiqueta="Factor con lluvia (>0 mm)"
              type="number"
              step="0.05"
              min="0.5"
              max="5"
              required
              value={lluviaCon}
              onChange={(e) => setLluviaCon(e.target.value)}
            />
            <CampoTexto
              id="regla-lluvia-sin"
              etiqueta="Factor sin lluvia (0 mm)"
              type="number"
              step="0.05"
              min="0.5"
              max="5"
              required
              value={lluviaSin}
              onChange={(e) => setLluviaSin(e.target.value)}
            />
          </div>

          {/* Franjas horarias */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2B28] dark:text-slate-200">
              Multiplicadores por franja horaria
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {(Object.keys(ETIQUETAS_FRANJA) as FranjaHoraria[]).map((franja) => (
                <CampoTexto
                  key={franja}
                  id={`horario-${franja}`}
                  etiqueta={ETIQUETAS_FRANJA[franja]}
                  type="number"
                  step="0.05"
                  min="0.5"
                  max="5"
                  required
                  value={horario[franja]}
                  onChange={(e) => setHorario((prev) => ({ ...prev, [franja]: e.target.value }))}
                />
              ))}
            </div>
          </div>

          {/* Curva de demanda por mil */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2B28] dark:text-slate-200">
                  Curva de demanda por zona (solicitudes activas × 1000 / choferes)
                </h3>
                <p className="text-[11px] text-[#5E5B54] dark:text-slate-400">
                  Los umbrales deben crecer y el multiplicador no puede disminuir al aumentar la demanda.
                </p>
              </div>
              <Boton type="button" variante="secundario" tamano="sm" onClick={agregarTramoDemanda}>
                + Agregar tramo
              </Boton>
            </div>

            <div className="space-y-2" data-testid="editor-curva-demanda">
              {demandaPorMil.map((tramo, idx) => (
                <div
                  key={`demanda-${idx}`}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end rounded-xl border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800/70 p-3"
                >
                  <div className="sm:col-span-5">
                    {tramo.abierto ? (
                      <div className="space-y-1.5">
                        <span className="block text-xs font-semibold text-[#2C2B28] dark:text-slate-200">Hasta (ratio × 1000)</span>
                        <div className="min-h-[44px] flex items-center rounded-lg border border-[#D4CFC2] dark:border-slate-700 bg-[#E5E0D4] dark:bg-slate-900 px-3 text-xs font-medium text-[#5E5B54] dark:text-slate-300">
                          Sin tope superior (tramo abierto final)
                        </div>
                      </div>
                    ) : (
                      <CampoTexto
                        id={`demanda-hasta-${idx}`}
                        etiqueta={`Tramo ${idx + 1}: hasta (ratio × 1000)`}
                        type="number"
                        step="1"
                        min="0"
                        required
                        value={tramo.hasta}
                        onChange={(e) => actualizarTramoDemanda(idx, "hasta", e.target.value)}
                      />
                    )}
                  </div>
                  <div className="sm:col-span-5">
                    <CampoTexto
                      id={`demanda-mult-${idx}`}
                      etiqueta={`Multiplicador tramo ${idx + 1}`}
                      type="number"
                      step="0.05"
                      min="0.5"
                      max="5"
                      required
                      value={tramo.multiplicador}
                      onChange={(e) => actualizarTramoDemanda(idx, "multiplicador", e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2 flex justify-end">
                    {!tramo.abierto && demandaPorMil.length > 1 && (
                      <Boton type="button" variante="peligro" tamano="sm" onClick={() => quitarTramoDemanda(idx)}>
                        Quitar
                      </Boton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Curva de disponibilidad */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2B28] dark:text-slate-200">
              Curva por disponibilidad de choferes cercanos
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              {disponibilidad.map((tramo, idx) => (
                <div key={`disp-${idx}`} className="rounded-xl border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800/70 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-[#5E5B54] dark:text-slate-300">
                    {tramo.abierto ? "Tramo abierto (más choferes)" : `Hasta ${tramo.hasta} chofer(es)`}
                  </p>
                  <CampoTexto
                    id={`disp-mult-${idx}`}
                    etiqueta="Multiplicador"
                    type="number"
                    step="0.05"
                    min="0.5"
                    max="5"
                    required
                    value={tramo.multiplicador}
                    onChange={(e) =>
                      setDisponibilidad((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, multiplicador: e.target.value } : item))
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DDD8CC] dark:border-slate-800 pt-4">
            <p className="text-xs text-[#5E5B54] dark:text-slate-400">
              El servidor asigna automáticamente número de versión, autor del JWT y fecha; las versiones previas no se sobreescriben.
            </p>
            <Boton type="submit" cargando={guardando} disabled={cargando || demandaPorMil.length === 0}>
              Publicar nueva versión
            </Boton>
          </div>
        </form>
      </Tarjeta>

      {/* Historial inmutable de versiones */}
      <Tarjeta
        titulo="Historial de versiones de la regla"
        subtitulo={`${historial.length} versión(es) auditada(s)`}
      >
        <TablaResponsiva
          columnas={columnasHistorial}
          datos={historial}
          obtenerClave={(r) => String(r.version)}
          cargando={cargando}
          error={errorPanel}
          mensajeCarga="Cargando historial de versiones..."
          mensajeVacio="No hay versiones registradas."
          onReintentar={() => void cargarReglas()}
          descripcionAccesible="Historial versionado de reglas de demanda"
        />
      </Tarjeta>

      {/* Gestión de Flota: Choferes, Habilitación y Vehículos */}
      <Tarjeta
        titulo="Gestión de Flota: Choferes y Vehículos"
        subtitulo="Alta, validación/habilitación administrativa y asignación de vehículos en ms-flota."
        data-testid="admin-gestion-flota"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <form onSubmit={registrarChoferAdmin} className="space-y-3 rounded-xl border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800/60 p-3.5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2B28] dark:text-slate-200">
                Registrar perfil de chofer
              </h3>
              <CampoTexto
                id="admin-chofer-usuario-id"
                etiqueta="ID de usuario (UUID)"
                placeholder="ej. 33333333-3333-4333-8333-333333333333"
                value={nuevoChoferId}
                onChange={(e) => setNuevoChoferId(e.target.value)}
                required
              />
              <Boton type="submit" variante="secundario" tamano="sm" cargando={cargandoFlota} disabled={!nuevoChoferId.trim()}>
                Registrar chofer
              </Boton>
            </form>

            <form onSubmit={registrarVehiculoAdmin} className="space-y-3 rounded-xl border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800/60 p-3.5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2B28] dark:text-slate-200">
                Registrar vehículo
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <CampoTexto id="veh-patente" etiqueta="Patente" placeholder="AB123CD" value={patente} onChange={(e) => setPatente(e.target.value)} required />
                <CampoTexto id="veh-tipo" etiqueta="Tipo" value={tipoVehiculo} onChange={(e) => setTipoVehiculo(e.target.value)} required />
                <CampoTexto id="veh-marca" etiqueta="Marca" placeholder="Fiat" value={marca} onChange={(e) => setMarca(e.target.value)} required />
                <CampoTexto id="veh-modelo" etiqueta="Modelo" placeholder="Cronos" value={modelo} onChange={(e) => setModelo(e.target.value)} required />
                <CampoTexto id="veh-anio" etiqueta="Año" type="number" min="1990" max="2035" value={anioVehiculo} onChange={(e) => setAnioVehiculo(e.target.value)} required />
                <CampoTexto id="veh-color" etiqueta="Color" placeholder="Gris" value={colorVehiculo} onChange={(e) => setColorVehiculo(e.target.value)} required />
                <CampoTexto id="veh-capacidad" etiqueta="Capacidad" type="number" min="1" max="20" value={capacidadVehiculo} onChange={(e) => setCapacidadVehiculo(e.target.value)} required />
              </div>
              <Boton type="submit" variante="secundario" tamano="sm" cargando={cargandoFlota}>
                Registrar vehículo
              </Boton>
            </form>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#2C2B28] dark:text-slate-200">
                Choferes registrados ({choferesFlota.length})
              </h3>
              <Boton type="button" variante="secundario" tamano="sm" onClick={() => void cargarFlota()} cargando={cargandoFlota}>
                Actualizar flota
              </Boton>
            </div>
            {choferesFlota.length === 0 ? (
              <p className="text-xs text-[#5E5B54] dark:text-slate-400">
                Sin choferes cargados o esperando respuesta de <code className="font-mono">ms-flota</code>.
              </p>
            ) : (
              <div className="space-y-2">
                {choferesFlota.map((c) => (
                  <div
                    key={c.usuario_id}
                    className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border border-[#DDD8CC] dark:border-slate-700 bg-[#F7F5F0] dark:bg-slate-800/70 p-3 text-xs"
                  >
                    <div className="space-y-1">
                      <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">{c.usuario_id}</p>
                      <p className="text-[#5E5B54] dark:text-slate-300">
                        Estado: <strong>{c.habilitado ? "Habilitado" : "Pendiente/Inhabilitado"}</strong> · Carnet:{" "}
                        <strong>{c.carnet_conducir_validado ? "Validado" : "Sin validar"}</strong> · Vehículo:{" "}
                        <strong>
                          {c.vehiculo_activo ? `${c.vehiculo_activo.marca} ${c.vehiculo_activo.modelo} (${c.vehiculo_activo.patente})` : "Sin asignar"}
                        </strong>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {vehiculosFlota.length > 0 && (
                        <>
                          <select
                            aria-label={`Vehículo para ${c.usuario_id}`}
                            value={vehiculoSeleccionadoPorChofer[c.usuario_id] ?? vehiculosFlota[0]?.id ?? ""}
                            onChange={(e) =>
                              setVehiculoSeleccionadoPorChofer((prev) => ({ ...prev, [c.usuario_id]: e.target.value }))
                            }
                            className="rounded-lg border border-[#D4CFC2] dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                          >
                            {vehiculosFlota.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.patente} — {v.marca} {v.modelo}
                              </option>
                            ))}
                          </select>
                          <Boton type="button" variante="secundario" tamano="sm" onClick={() => void asignarVehiculo(c.usuario_id)}>
                            Asignar vehículo
                          </Boton>
                        </>
                      )}
                      <Boton type="button" variante={c.habilitado ? "peligro" : "primario"} tamano="sm" onClick={() => void alternarHabilitacionChofer(c)}>
                        {c.habilitado ? "Inhabilitar" : "Habilitar chofer"}
                      </Boton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Tarjeta>

      <Toast
        mensaje={toast?.mensaje ?? null}
        tipo={toast?.tipo ?? "info"}
        onCerrar={() => setToast(null)}
      />
    </section>
  );
};
