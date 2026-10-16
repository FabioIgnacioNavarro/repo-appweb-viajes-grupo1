import { Pool, type PoolConfig } from "pg";
import { ErrorTarifas, type EstimacionTarifa, type FactoresPrecio, type FranjaHoraria, type ReglaTarifa, type RepositorioEstimaciones, type RepositorioReglas, type RepositorioZonas, type ZonaTarifaria } from "./dominio";

type FilaRegla = {
  version: number;
  tarifa_base_pesos: string;
  precio_por_kilometro_pesos: string;
  precio_por_minuto_pesos: string;
  multiplicador_minimo_escalado: number;
  multiplicador_maximo_escalado: number;
  factores: {
    lluvia_con_precipitacion_escalado: number;
    lluvia_sin_precipitacion_escalado: number;
    disponibilidad: ReglaTarifa["disponibilidad"];
    demanda_por_mil: ReglaTarifa["demandaPorMil"];
    horario: ReglaTarifa["horario"];
  };
};

type FilaZona = {
  id: string; nombre: string; latitud_centro: string; longitud_centro: string;
  radio_metros: number; zona_horaria: string;
};

type FilaEstimacion = {
  id: string; pasajero_id: string; origen_latitud: string; origen_longitud: string;
  destino_latitud: string; destino_longitud: string; zona_id: string; zona_nombre: string;
  zona_latitud_centro: string; zona_longitud_centro: string; zona_radio_metros: number;
  zona_horaria: string; precio_estimado: string; distancia_metros: number;
  duracion_segundos: number; proveedor_ruta: EstimacionTarifa["proveedorRuta"];
  polilinea: string | null; multiplicador_demanda_escalado: number;
  factores_precio: FactoresPrecio; version_regla: number; creada_en: Date; vigente_hasta: Date;
};

export class RepositorioReglasPostgres implements RepositorioReglas {
  constructor(private readonly pool: Pool) {}
  async obtenerActiva(): Promise<ReglaTarifa> {
    const resultado = await this.pool.query<FilaRegla>("SELECT version, tarifa_base_pesos, precio_por_kilometro_pesos, precio_por_minuto_pesos, multiplicador_minimo_escalado, multiplicador_maximo_escalado, factores FROM tarifa.regla_tarifa WHERE activa = TRUE ORDER BY version DESC LIMIT 1");
    const fila = resultado.rows[0];
    if (!fila) throw new ErrorTarifas("REGLA_NO_CONFIGURADA", "No hay una regla de tarifa activa.");
    return {
      version: fila.version,
      tarifaBasePesos: BigInt(fila.tarifa_base_pesos),
      precioPorKilometroPesos: BigInt(fila.precio_por_kilometro_pesos),
      precioPorMinutoPesos: BigInt(fila.precio_por_minuto_pesos),
      multiplicadorMinimoEscalado: fila.multiplicador_minimo_escalado,
      multiplicadorMaximoEscalado: fila.multiplicador_maximo_escalado,
      lluviaConPrecipitacionEscalado: fila.factores.lluvia_con_precipitacion_escalado,
      lluviaSinPrecipitacionEscalado: fila.factores.lluvia_sin_precipitacion_escalado,
      disponibilidad: fila.factores.disponibilidad,
      demandaPorMil: fila.factores.demanda_por_mil,
      horario: fila.factores.horario
    };
  }
}

export class RepositorioZonasPostgres implements RepositorioZonas {
  constructor(private readonly pool: Pool) {}
  async resolver(coordenada: { latitud: number; longitud: number }): Promise<ZonaTarifaria> {
    const resultado = await this.pool.query<FilaZona>(`SELECT id, nombre, latitud_centro, longitud_centro, radio_metros, zona_horaria
      FROM tarifa.zona_tarifaria WHERE activa = TRUE
      AND $1 BETWEEN latitud_minima AND latitud_maxima
      AND $2 BETWEEN longitud_minima AND longitud_maxima
      ORDER BY prioridad DESC LIMIT 1`, [coordenada.latitud, coordenada.longitud]);
    const fila = resultado.rows[0];
    if (!fila) throw new ErrorTarifas("ZONA_NO_ENCONTRADA", "No hay una zona tarifaria configurada para el origen.");
    return { id: fila.id, nombre: fila.nombre, centro: { latitud: Number(fila.latitud_centro), longitud: Number(fila.longitud_centro) }, radioMetros: fila.radio_metros, zonaHoraria: fila.zona_horaria };
  }
}

export class RepositorioEstimacionesPostgres implements RepositorioEstimaciones {
  constructor(private readonly pool: Pool) {}
  async guardar(estimacion: EstimacionTarifa): Promise<void> {
    await this.pool.query(`INSERT INTO tarifa.estimacion (
      id, pasajero_id, origen_latitud, origen_longitud, destino_latitud, destino_longitud,
      zona_id, precio_estimado, distancia_metros, duracion_segundos, proveedor_ruta, polilinea,
      multiplicador_demanda_escalado, factores_precio, version_regla, creada_en, vigente_hasta
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
      estimacion.id, estimacion.pasajeroId, estimacion.origen.latitud, estimacion.origen.longitud,
      estimacion.destino.latitud, estimacion.destino.longitud, estimacion.zona.id,
      estimacion.precioEstimado.toString(), estimacion.distanciaMetros, estimacion.duracionSegundos,
      estimacion.proveedorRuta, estimacion.polilinea ?? null, estimacion.multiplicadorDemandaEscalado,
      JSON.stringify(estimacion.factoresPrecio), estimacion.versionRegla, estimacion.creadaEn, estimacion.vigenteHasta
    ]);
  }
  async obtener(id: string): Promise<EstimacionTarifa | undefined> {
    const resultado = await this.pool.query<FilaEstimacion>(`SELECT e.id, e.pasajero_id,
      e.origen_latitud, e.origen_longitud, e.destino_latitud, e.destino_longitud,
      z.id AS zona_id, z.nombre AS zona_nombre, z.latitud_centro AS zona_latitud_centro,
      z.longitud_centro AS zona_longitud_centro, z.radio_metros AS zona_radio_metros,
      z.zona_horaria, e.precio_estimado, e.distancia_metros, e.duracion_segundos,
      e.proveedor_ruta, e.polilinea, e.multiplicador_demanda_escalado, e.factores_precio,
      e.version_regla, e.creada_en, e.vigente_hasta
      FROM tarifa.estimacion e INNER JOIN tarifa.zona_tarifaria z ON z.id = e.zona_id
      WHERE e.id = $1`, [id]);
    const fila = resultado.rows[0];
    if (!fila) return undefined;
    return {
      id: fila.id, pasajeroId: fila.pasajero_id,
      origen: { latitud: Number(fila.origen_latitud), longitud: Number(fila.origen_longitud) },
      destino: { latitud: Number(fila.destino_latitud), longitud: Number(fila.destino_longitud) },
      zona: { id: fila.zona_id, nombre: fila.zona_nombre, centro: { latitud: Number(fila.zona_latitud_centro), longitud: Number(fila.zona_longitud_centro) }, radioMetros: fila.zona_radio_metros, zonaHoraria: fila.zona_horaria },
      precioEstimado: BigInt(fila.precio_estimado), moneda: "ARS", distanciaMetros: fila.distancia_metros,
      duracionSegundos: fila.duracion_segundos, proveedorRuta: fila.proveedor_ruta,
      polilinea: fila.polilinea ?? undefined, multiplicadorDemandaEscalado: fila.multiplicador_demanda_escalado,
      factoresPrecio: { ...fila.factores_precio, climaObservadoEn: new Date(fila.factores_precio.climaObservadoEn) },
      versionRegla: fila.version_regla, creadaEn: new Date(fila.creada_en), vigenteHasta: new Date(fila.vigente_hasta)
    };
  }
}

export function crearPoolTarifas(env: NodeJS.ProcessEnv = process.env): Pool {
  const cadena = env.DATABASE_URL;
  const maximo = Number(env.DATABASE_POOL_MAX ?? "10");
  if (!cadena) throw new Error("DATABASE_URL es obligatoria para ms-tarifas.");
  if (!Number.isInteger(maximo) || maximo < 1 || maximo > 50) throw new Error("DATABASE_POOL_MAX debe ser un entero entre 1 y 50.");
  const configuracion: PoolConfig = { connectionString: cadena, max: maximo, connectionTimeoutMillis: 1500, idleTimeoutMillis: 30_000 };
  return new Pool(configuracion);
}
