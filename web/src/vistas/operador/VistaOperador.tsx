import React, { useCallback, useEffect, useState } from "react";
import { clienteApi, ErrorHttpApi } from "../../nucleo/api";
import {
  Boton,
  CampoSelect,
  CampoTexto,
  IconoSoporte,
  InsigniaEstadoViaje,
  Modal,
  TablaResponsiva,
  Tarjeta,
  Toast,
  type ColumnaTabla,
} from "../../componentes/comunes";

interface ViajeOperadorDto {
  id_viaje: string;
  pasajero_id: string;
  chofer_id: string | null;
  id_estimacion: string;
  precio_estimado: string;
  precio_final: string | null;
  moneda: "ARS";
  multiplicador_demanda: number;
  estado: string;
  creado_en: string;
}

interface ListadoViajesDto {
  viajes: ViajeOperadorDto[];
  pagina?: number;
  limite?: number;
  total?: number;
}

interface AuditoriaTarifaDto {
  id_viaje: string;
  id_estimacion: string;
  precio_confirmado: string;
  moneda: "ARS";
  multiplicador_demanda: number;
  factores_precio: Record<string, unknown>;
  version_regla: number;
  congelada_en: string;
}

const OPCIONES_ESTADO = [
  { valor: "", etiqueta: "Todos los estados" },
  { valor: "solicitado", etiqueta: "Solicitado" },
  { valor: "asignado", etiqueta: "Asignado" },
  { valor: "chofer_en_camino", etiqueta: "Chofer en camino" },
  { valor: "en_curso", etiqueta: "En curso" },
  { valor: "finalizado", etiqueta: "Finalizado" },
  { valor: "cancelado_por_pasajero", etiqueta: "Cancelado (pasajero)" },
  { valor: "cancelado_por_chofer", etiqueta: "Cancelado (chofer)" },
  { valor: "cancelado_por_operador", etiqueta: "Cancelado (operador)" },
  { valor: "sin_choferes_disponibles", etiqueta: "Sin choferes disponibles" },
];

const OPCIONES_LIMITE = [
  { valor: "10", etiqueta: "10 por página" },
  { valor: "20", etiqueta: "20 por página" },
  { valor: "50", etiqueta: "50 por página" },
];

const ESTADOS_ACTIVOS = new Set(["solicitado", "asignado", "chofer_en_camino", "en_curso"]);

function importePesos(importe: string | null | undefined): string {
  if (!importe) return "—";
  const digitos = importe.replace(/\D/g, "");
  if (!digitos) return "—";
  return `$ ${digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ARS`;
}

function formatearFecha(iso: string | undefined): string {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (!Number.isFinite(fecha.getTime())) return iso;
  return fecha.toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function convertirFechaHastaExclusiva(fechaYmd: string): string {
  const [anio, mes, dia] = fechaYmd.split("-").map(Number);
  const siguienteDiaUtc = new Date(Date.UTC(anio, mes - 1, dia + 1, 0, 0, 0));
  return siguienteDiaUtc.toISOString();
}

function textoFactor(valor: unknown, sufijo = ""): string {
  if (valor === undefined || valor === null) return "—";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "number") return `${valor}${sufijo}`;
  return `${String(valor)}${sufijo}`;
}

export const VistaOperador: React.FC = () => {
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const [desdeFiltro, setDesdeFiltro] = useState("");
  const [hastaFiltro, setHastaFiltro] = useState("");
  const [limite, setLimite] = useState(20);
  const [pagina, setPagina] = useState(1);

  const [viajes, setViajes] = useState<ViajeOperadorDto[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [cargando, setCargando] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);

  const [viajeAuditadoId, setViajeAuditadoId] = useState<string | null>(null);
  const [auditoria, setAuditoria] = useState<AuditoriaTarifaDto | null>(null);
  const [cargandoAuditoria, setCargandoAuditoria] = useState(false);
  const [errorAuditoria, setErrorAuditoria] = useState<string | null>(null);

  const [toast, setToast] = useState<{ mensaje: string; tipo: "exito" | "error" | "info" } | null>(null);

  const cargarViajes = useCallback(
    async (paginaDestino: number, filtros?: { estado: string; desde: string; hasta: string; limite: number }) => {
      const cfg = filtros ?? { estado: estadoFiltro, desde: desdeFiltro, hasta: hastaFiltro, limite };
      if (cfg.desde && cfg.hasta && cfg.desde > cfg.hasta) {
        setErrorListado("La fecha 'Desde' no puede ser posterior a la fecha 'Hasta'.");
        return;
      }

      setCargando(true);
      setErrorListado(null);

      try {
        const params = new URLSearchParams();
        params.set("pagina", String(paginaDestino));
        params.set("limite", String(cfg.limite));
        if (cfg.estado) params.set("estado", cfg.estado);
        if (cfg.desde) params.set("desde", `${cfg.desde}T00:00:00.000Z`);
        if (cfg.hasta) params.set("hasta", convertirFechaHastaExclusiva(cfg.hasta));

        const res = await clienteApi.get<ListadoViajesDto>(`/viajes?${params.toString()}`);
        if (!res || typeof res !== "object" || !Array.isArray(res.viajes)) {
          setViajes([]);
          setTotal(0);
          setErrorListado("Servicio ms-viajes no disponible o respuesta inválida al consultar /viajes.");
          return;
        }
        const lista = res.viajes;
        setViajes(lista);
        setPagina(res.pagina ?? paginaDestino);
        setTotal(res.total ?? lista.length);
      } catch (err) {
        const msg = err instanceof ErrorHttpApi ? `${err.codigo}: ${err.mensaje}` : "No se pudo obtener el listado de viajes.";
        setErrorListado(msg);
      } finally {
        setCargando(false);
      }
    },
    [estadoFiltro, desdeFiltro, hastaFiltro, limite]
  );

  useEffect(() => {
    void cargarViajes(1);
  }, [cargarViajes]);

  const abrirAuditoria = useCallback(async (idViaje: string) => {
    setViajeAuditadoId(idViaje);
    setAuditoria(null);
    setErrorAuditoria(null);
    setCargandoAuditoria(true);

    try {
      const res = await clienteApi.get<AuditoriaTarifaDto>(`/viajes/${encodeURIComponent(idViaje)}/auditoria-tarifa`);
      setAuditoria(res);
    } catch (err) {
      const msg = err instanceof ErrorHttpApi ? `${err.codigo}: ${err.mensaje}` : "No se pudo consultar la auditoría del viaje.";
      setErrorAuditoria(msg);
      setToast({ mensaje: msg, tipo: "error" });
    } finally {
      setCargandoAuditoria(false);
    }
  }, []);

  const manejarFiltrar = (e: React.FormEvent) => {
    e.preventDefault();
    void cargarViajes(1);
  };

  const limpiarFiltros = () => {
    setEstadoFiltro("");
    setDesdeFiltro("");
    setHastaFiltro("");
    setLimite(20);
    void cargarViajes(1, { estado: "", desde: "", hasta: "", limite: 20 });
  };

  const totalPaginas = Math.max(1, Math.ceil(total / limite));
  const activosEnPagina = viajes.filter((v) => ESTADOS_ACTIVOS.has(v.estado.toLowerCase())).length;

  const columnas: ColumnaTabla<ViajeOperadorDto>[] = [
    {
      clave: "id_viaje",
      encabezado: "Viaje",
      renderizar: (v) => (
        <div className="space-y-0.5">
          <span className="font-mono text-xs font-semibold text-slate-900" title={v.id_viaje}>
            {v.id_viaje}
          </span>
          <p className="text-[11px] text-slate-500">Pasajero: {v.pasajero_id}</p>
        </div>
      ),
    },
    {
      clave: "estado",
      encabezado: "Estado",
      renderizar: (v) => <InsigniaEstadoViaje estado={v.estado} />,
    },
    {
      clave: "chofer",
      encabezado: "Chofer asignado",
      ocultarEnMovil: false,
      renderizar: (v) => (
        <span className="text-xs text-slate-700 font-mono">{v.chofer_id ?? "Sin asignar"}</span>
      ),
    },
    {
      clave: "multiplicador",
      encabezado: "Multiplicador",
      alinearDerecha: true,
      renderizar: (v) => (
        <span className="inline-flex rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 font-mono text-xs font-semibold text-amber-900">
          {Number(v.multiplicador_demanda).toFixed(2)}x
        </span>
      ),
    },
    {
      clave: "importe",
      encabezado: "Importe",
      alinearDerecha: true,
      renderizar: (v) => (
        <div className="text-right">
          <span className="font-semibold text-slate-900">{importePesos(v.precio_final ?? v.precio_estimado)}</span>
          {v.precio_final && (
            <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Final</p>
          )}
        </div>
      ),
    },
    {
      clave: "creado_en",
      encabezado: "Solicitado",
      ocultarEnMovil: true,
      renderizar: (v) => <span className="text-xs text-slate-600">{formatearFecha(v.creado_en)}</span>,
    },
    {
      clave: "acciones",
      encabezado: "Auditoría",
      alinearDerecha: true,
      renderizar: (v) => (
        <Boton
          variante="secundario"
          tamano="sm"
          onClick={() => void abrirAuditoria(v.id_viaje)}
        >
          Auditar tarifa
        </Boton>
      ),
    },
  ];

  const factores = auditoria?.factores_precio ?? {};

  return (
    <section className="space-y-6" data-testid="vista-operador">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 shrink-0">
            <IconoSoporte className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900">
              Supervisión de Viajes en Tiempo Real
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              Panel operativo con filtros globales y auditoría inmutable de tarifa y demanda (API-002).
            </p>
          </div>
        </div>
        <Boton
          variante="secundario"
          onClick={() => void cargarViajes(pagina)}
          cargando={cargando}
        >
          Actualizar listado
        </Boton>
      </div>

      {/* KPIs reales del listado */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total filtrado</p>
          <p className="text-xl font-bold text-slate-900 mt-1" data-testid="operador-kpi-total">
            {cargando ? "—" : total}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">En página actual</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{cargando ? "—" : viajes.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Activos visibles</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">{cargando ? "—" : activosEnPagina}</p>
        </div>
      </div>

      {/* Filtros de búsqueda */}
      <Tarjeta titulo="Filtros de supervisión">
        <form onSubmit={manejarFiltrar} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <CampoSelect
            id="filtro-estado"
            etiqueta="Estado del viaje"
            value={estadoFiltro}
            onChange={(e) => setEstadoFiltro(e.target.value)}
            opciones={OPCIONES_ESTADO}
          />
          <CampoTexto
            id="filtro-desde"
            etiqueta="Desde (UTC)"
            type="date"
            value={desdeFiltro}
            onChange={(e) => setDesdeFiltro(e.target.value)}
          />
          <CampoTexto
            id="filtro-hasta"
            etiqueta="Hasta (inclusive)"
            type="date"
            value={hastaFiltro}
            onChange={(e) => setHastaFiltro(e.target.value)}
          />
          <CampoSelect
            id="filtro-limite"
            etiqueta="Resultados por página"
            value={String(limite)}
            onChange={(e) => setLimite(Number(e.target.value))}
            opciones={OPCIONES_LIMITE}
          />
          <div className="flex gap-2">
            <Boton type="submit" className="flex-1" cargando={cargando}>
              Filtrar
            </Boton>
            <Boton type="button" variante="secundario" onClick={limpiarFiltros}>
              Limpiar
            </Boton>
          </div>
        </form>
      </Tarjeta>

      {/* Tabla responsiva de viajes */}
      <Tarjeta
        titulo="Viajes registrados"
        subtitulo={`Página ${pagina} de ${totalPaginas} · ${total} viaje(s)`}
        accion={
          <div className="flex items-center gap-2">
            <Boton
              variante="secundario"
              tamano="sm"
              disabled={cargando || pagina <= 1}
              onClick={() => void cargarViajes(pagina - 1)}
            >
              Anterior
            </Boton>
            <Boton
              variante="secundario"
              tamano="sm"
              disabled={cargando || pagina >= totalPaginas}
              onClick={() => void cargarViajes(pagina + 1)}
            >
              Siguiente
            </Boton>
          </div>
        }
      >
        <TablaResponsiva
          columnas={columnas}
          datos={viajes}
          obtenerClave={(v) => v.id_viaje}
          cargando={cargando}
          error={errorListado}
          mensajeCarga="Consultando viajes en ms-viajes..."
          mensajeVacio="No hay viajes que coincidan con los filtros seleccionados."
          onReintentar={() => void cargarViajes(pagina)}
          descripcionAccesible="Listado global de viajes para supervisión operativa"
        />
      </Tarjeta>

      {/* Modal de Auditoría Inmutable */}
      <Modal
        abierto={viajeAuditadoId !== null}
        titulo={viajeAuditadoId ? `Auditoría de tarifa · ${viajeAuditadoId}` : "Auditoría de tarifa"}
        onCerrar={() => setViajeAuditadoId(null)}
        pie={
          <Boton variante="secundario" onClick={() => setViajeAuditadoId(null)}>
            Cerrar
          </Boton>
        }
      >
        {cargandoAuditoria && <p className="text-slate-600">Cargando snapshot congelado...</p>}
        {errorAuditoria && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {errorAuditoria}
          </div>
        )}
        {auditoria && !cargandoAuditoria && (
          <div className="space-y-4" data-testid="modal-auditoria-contenido">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">Precio confirmado congelado</span>
                <span className="inline-flex rounded-full bg-emerald-100 text-emerald-900 px-2.5 py-0.5 text-[11px] font-semibold">
                  Regla v{auditoria.version_regla} · Inmutable
                </span>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {importePesos(auditoria.precio_confirmado)}
              </p>
              <p className="text-xs text-slate-600">
                Multiplicador aplicado:{" "}
                <strong className="font-mono text-slate-900">
                  {Number(auditoria.multiplicador_demanda).toFixed(4)}x
                </strong>{" "}
                · Congelada: {formatearFecha(auditoria.congelada_en)}
              </p>
              <p className="text-[11px] font-mono text-slate-500 break-all">
                Estimación origen: {auditoria.id_estimacion}
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">
                Desglose de factores (Variante A)
              </h3>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <dt className="text-slate-500">Zona</dt>
                  <dd className="font-semibold text-slate-900">{textoFactor(factores.zona_id)}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <dt className="text-slate-500">Franja horaria</dt>
                  <dd className="font-semibold text-slate-900 uppercase">{textoFactor(factores.franja_horaria)}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <dt className="text-slate-500">Solicitudes / Choferes</dt>
                  <dd className="font-semibold text-slate-900 font-mono">
                    {textoFactor(factores.solicitudes_activas)} / {textoFactor(factores.choferes_disponibles)}
                  </dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <dt className="text-slate-500">Clima ({textoFactor(factores.fuente_clima)})</dt>
                  <dd className="font-semibold text-slate-900">
                    {textoFactor(factores.llueve)} ({textoFactor(factores.precipitacion_mm, " mm")})
                  </dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <dt className="text-slate-500">Factor lluvia</dt>
                  <dd className="font-mono font-semibold text-slate-900">{textoFactor(factores.factor_lluvia, "x")}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <dt className="text-slate-500">Factor disponibilidad</dt>
                  <dd className="font-mono font-semibold text-slate-900">{textoFactor(factores.factor_disponibilidad, "x")}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <dt className="text-slate-500">Factor demanda</dt>
                  <dd className="font-mono font-semibold text-slate-900">{textoFactor(factores.factor_demanda, "x")}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5">
                  <dt className="text-slate-500">Factor horario</dt>
                  <dd className="font-mono font-semibold text-slate-900">{textoFactor(factores.factor_horario, "x")}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </Modal>

      <Toast
        mensaje={toast?.mensaje ?? null}
        tipo={toast?.tipo ?? "info"}
        onCerrar={() => setToast(null)}
      />
    </section>
  );
};
