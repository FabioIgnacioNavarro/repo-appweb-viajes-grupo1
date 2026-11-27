import { Pool, type PoolConfig } from "pg";
import {
  distanciaHaversineMetros,
  ErrorFlota,
  type AsignacionVehiculo,
  type Chofer,
  type ChoferCercano,
  type Coordenada,
  type RepositorioChoferes,
  type RepositorioUbicaciones,
  type RepositorioVehiculos,
  type UbicacionActual,
  type Vehiculo
} from "./dominio";

type FilaChofer = {
  id: string; usuario_id: string; habilitado: boolean; disponibilidad: boolean;
  carnet_conducir_validado: boolean; fecha_creacion: Date; fecha_actualizacion: Date;
};
type FilaUbicacion = { id: string; usuario_id: string; latitud: string; longitud: string; actualizado_at: Date; precision_metros: string | null };
type FilaVehiculo = {
  id: string; patente: string; tipo_vehiculo: string; marca: string; modelo: string;
  anio_fabricacion: number; color: string; capacidad_pasajeros: number;
  estado: "ACTIVO" | "INACTIVO"; created_at: Date; updated_at: Date;
};
type FilaAsignacion = {
  id: string; usuario_chofer_id: string; vehiculo_id: string;
  estado_asignacion: "ACTIVA" | "INACTIVA"; asignado_at: Date; desasignado_at: Date | null;
};

function mapearChofer(fila: FilaChofer): Chofer {
  return { id: fila.id, usuarioId: fila.usuario_id, habilitado: fila.habilitado, disponibilidad: fila.disponibilidad, carnetConducirValidado: fila.carnet_conducir_validado, fechaCreacion: new Date(fila.fecha_creacion), fechaActualizacion: new Date(fila.fecha_actualizacion) };
}
function mapearUbicacion(fila: FilaUbicacion): UbicacionActual {
  return { id: fila.id, usuarioId: fila.usuario_id, latitud: Number(fila.latitud), longitud: Number(fila.longitud), actualizadoAt: new Date(fila.actualizado_at), precisionMetros: fila.precision_metros === null ? undefined : Number(fila.precision_metros) };
}
function mapearVehiculo(fila: FilaVehiculo): Vehiculo {
  return {
    id: fila.id, patente: fila.patente, tipoVehiculo: fila.tipo_vehiculo,
    marca: fila.marca, modelo: fila.modelo, anioFabricacion: Number(fila.anio_fabricacion),
    color: fila.color, capacidadPasajeros: Number(fila.capacidad_pasajeros),
    estado: fila.estado, createdAt: new Date(fila.created_at), updatedAt: new Date(fila.updated_at)
  };
}
function mapearAsignacion(fila: FilaAsignacion): AsignacionVehiculo {
  return {
    id: fila.id, usuarioChoferId: fila.usuario_chofer_id, vehiculoId: fila.vehiculo_id,
    estadoAsignacion: fila.estado_asignacion, asignadoAt: new Date(fila.asignado_at),
    desasignadoAt: fila.desasignado_at ? new Date(fila.desasignado_at) : undefined
  };
}

export class RepositorioChoferesPostgres implements RepositorioChoferes {
  constructor(private readonly pool: Pool, private readonly modoBusqueda: "optimizada" | "ingenua" = "optimizada") {}

  async obtenerPorUsuario(usuarioId: string): Promise<Chofer | undefined> {
    const resultado = await this.pool.query<FilaChofer>("SELECT id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado, fecha_creacion, fecha_actualizacion FROM usuario_chofer WHERE usuario_id = $1", [usuarioId]);
    return resultado.rows[0] ? mapearChofer(resultado.rows[0]) : undefined;
  }

  async listarTodos(): Promise<Chofer[]> {
    const resultado = await this.pool.query<FilaChofer>("SELECT id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado, fecha_creacion, fecha_actualizacion FROM usuario_chofer ORDER BY fecha_creacion ASC");
    return resultado.rows.map(mapearChofer);
  }

  async guardar(chofer: Chofer): Promise<Chofer> {
    const resultado = await this.pool.query<FilaChofer>(
      `INSERT INTO usuario_chofer (id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado, fecha_creacion, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (usuario_id) DO UPDATE SET
         habilitado = EXCLUDED.habilitado,
         disponibilidad = EXCLUDED.disponibilidad,
         carnet_conducir_validado = EXCLUDED.carnet_conducir_validado,
         fecha_actualizacion = EXCLUDED.fecha_actualizacion
       RETURNING id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado, fecha_creacion, fecha_actualizacion`,
      [chofer.id, chofer.usuarioId, chofer.habilitado, chofer.disponibilidad, chofer.carnetConducirValidado, chofer.fechaCreacion, chofer.fechaActualizacion]
    );
    return mapearChofer(resultado.rows[0]);
  }

  async buscarDisponiblesCercanos(origen: Coordenada, radioMetros: number, ahora: Date, antiguedadMaximaMs: number): Promise<ChoferCercano[]> {
    if (this.modoBusqueda === "ingenua") {
      // Variante ingenua de referencia (ADR 0005): trae todas las ubicaciones a memoria y filtra/ordena en Node.js.
      const resultado = await this.pool.query<FilaUbicacion & { habilitado: boolean; disponibilidad: boolean; carnet_conducir_validado: boolean }>(`
        SELECT u.id, u.usuario_id, u.latitud, u.longitud, u.actualizado_at, u.precision_metros,
               c.habilitado, c.disponibilidad, c.carnet_conducir_validado
        FROM ubicacion_actual u
        INNER JOIN usuario_chofer c ON c.usuario_id = u.usuario_id
      `);
      return resultado.rows
        .flatMap((fila) => {
          if (!fila.habilitado || !fila.disponibilidad || !fila.carnet_conducir_validado) return [];
          const ubicacion = mapearUbicacion(fila);
          if (ahora.getTime() - ubicacion.actualizadoAt.getTime() > antiguedadMaximaMs) return [];
          const distanciaMetros = distanciaHaversineMetros(origen, ubicacion);
          return distanciaMetros <= radioMetros ? [{ ...ubicacion, distanciaMetros }] : [];
        })
        .sort((a, b) => a.distanciaMetros - b.distanciaMetros)
        .slice(0, 100);
    }

    const radioTierra = 6_371_000;
    const latitudDelta = radioMetros / radioTierra * 180 / Math.PI;
    const longitudDelta = radioMetros / (radioTierra * Math.cos(origen.latitud * Math.PI / 180)) * 180 / Math.PI;
    const resultado = await this.pool.query<FilaUbicacion & { distancia_metros: number }>(`
      SELECT u.id, u.usuario_id, u.latitud, u.longitud, u.actualizado_at, u.precision_metros,
        $1 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(u.latitud - $2) / 2), 2) +
          COS(RADIANS($2)) * COS(RADIANS(u.latitud)) * POWER(SIN(RADIANS(u.longitud - $3) / 2), 2)
        )) AS distancia_metros
      FROM ubicacion_actual u
      INNER JOIN usuario_chofer c ON c.usuario_id = u.usuario_id
      WHERE c.habilitado = TRUE
        AND c.disponibilidad = TRUE
        AND c.carnet_conducir_validado = TRUE
        AND u.actualizado_at >= $4::timestamptz - ($5::double precision * INTERVAL '1 millisecond')
        AND u.latitud BETWEEN $2 - $6 AND $2 + $6
        AND u.longitud BETWEEN $3 - $7 AND $3 + $7
      ORDER BY distancia_metros ASC
      LIMIT 100`, [radioTierra, origen.latitud, origen.longitud, ahora, antiguedadMaximaMs, latitudDelta, longitudDelta]);
    return resultado.rows.filter((fila) => Number(fila.distancia_metros) <= radioMetros).map((fila) => ({ ...mapearUbicacion(fila), distanciaMetros: Number(fila.distancia_metros) }));
  }
}

export class RepositorioUbicacionesPostgres implements RepositorioUbicaciones {
  constructor(private readonly pool: Pool, private readonly generarId: () => string) {}

  async obtenerActual(usuarioId: string): Promise<UbicacionActual | undefined> {
    const resultado = await this.pool.query<FilaUbicacion>("SELECT id, usuario_id, latitud, longitud, actualizado_at, precision_metros FROM ubicacion_actual WHERE usuario_id = $1", [usuarioId]);
    return resultado.rows[0] ? mapearUbicacion(resultado.rows[0]) : undefined;
  }

  async guardarSiEsMasNueva(ubicacion: UbicacionActual): Promise<UbicacionActual> {
    const resultado = await this.pool.query<FilaUbicacion>(`INSERT INTO ubicacion_actual (id, usuario_id, latitud, longitud, actualizado_at, precision_metros) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (usuario_id) DO UPDATE SET latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, actualizado_at = EXCLUDED.actualizado_at, precision_metros = EXCLUDED.precision_metros WHERE ubicacion_actual.actualizado_at < EXCLUDED.actualizado_at RETURNING id, usuario_id, latitud, longitud, actualizado_at, precision_metros`, [ubicacion.id || this.generarId(), ubicacion.usuarioId, ubicacion.latitud, ubicacion.longitud, ubicacion.actualizadoAt, ubicacion.precisionMetros ?? null]);
    if (resultado.rows[0]) return mapearUbicacion(resultado.rows[0]);
    const anterior = await this.obtenerActual(ubicacion.usuarioId);
    if (!anterior) throw new Error("No se pudo guardar la ubicación.");
    return anterior;
  }

  async registrarHistoricaSiCorresponde(ubicacion: UbicacionActual, intervaloMinimoMs = 15_000, viajeId?: string): Promise<boolean> {
    const ultima = await this.pool.query<{ registrado_at: Date }>(
      "SELECT registrado_at FROM ubicacion_historica WHERE usuario_id = $1 ORDER BY registrado_at DESC LIMIT 1",
      [ubicacion.usuarioId]
    );
    if (ultima.rows[0] && ubicacion.actualizadoAt.getTime() - new Date(ultima.rows[0].registrado_at).getTime() < intervaloMinimoMs) {
      return false;
    }
    await this.pool.query(
      `INSERT INTO ubicacion_historica (id, usuario_id, viaje_id, latitud, longitud, registrado_at, precision_metros)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [this.generarId(), ubicacion.usuarioId, viajeId ?? null, ubicacion.latitud, ubicacion.longitud, ubicacion.actualizadoAt, ubicacion.precisionMetros ?? null]
    );
    return true;
  }

  async eliminarHistoricasAnterioresA(limite: Date): Promise<number> {
    const resultado = await this.pool.query("DELETE FROM ubicacion_historica WHERE registrado_at < $1", [limite]);
    return resultado.rowCount ?? 0;
  }
}

export class RepositorioVehiculosPostgres implements RepositorioVehiculos {
  constructor(private readonly pool: Pool) {}

  async guardar(vehiculo: Vehiculo): Promise<Vehiculo> {
    try {
      const resultado = await this.pool.query<FilaVehiculo>(
        `INSERT INTO vehiculo (id, patente, tipo_vehiculo, marca, modelo, anio_fabricacion, color, capacidad_pasajeros, estado, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           tipo_vehiculo = EXCLUDED.tipo_vehiculo,
           marca = EXCLUDED.marca,
           modelo = EXCLUDED.modelo,
           anio_fabricacion = EXCLUDED.anio_fabricacion,
           color = EXCLUDED.color,
           capacidad_pasajeros = EXCLUDED.capacidad_pasajeros,
           estado = EXCLUDED.estado,
           updated_at = EXCLUDED.updated_at
         RETURNING id, patente, tipo_vehiculo, marca, modelo, anio_fabricacion, color, capacidad_pasajeros, estado, created_at, updated_at`,
        [vehiculo.id, vehiculo.patente, vehiculo.tipoVehiculo, vehiculo.marca, vehiculo.modelo, vehiculo.anioFabricacion, vehiculo.color, vehiculo.capacidadPasajeros, vehiculo.estado, vehiculo.createdAt, vehiculo.updatedAt]
      );
      return mapearVehiculo(resultado.rows[0]);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") {
        throw new ErrorFlota("VEHICULO_YA_EXISTE", "Ya existe un vehículo registrado con esa patente.");
      }
      throw error;
    }
  }

  async obtener(id: string): Promise<Vehiculo | undefined> {
    const resultado = await this.pool.query<FilaVehiculo>(
      "SELECT id, patente, tipo_vehiculo, marca, modelo, anio_fabricacion, color, capacidad_pasajeros, estado, created_at, updated_at FROM vehiculo WHERE id = $1",
      [id]
    );
    return resultado.rows[0] ? mapearVehiculo(resultado.rows[0]) : undefined;
  }

  async obtenerPorPatente(patente: string): Promise<Vehiculo | undefined> {
    const resultado = await this.pool.query<FilaVehiculo>(
      "SELECT id, patente, tipo_vehiculo, marca, modelo, anio_fabricacion, color, capacidad_pasajeros, estado, created_at, updated_at FROM vehiculo WHERE patente = $1",
      [patente.trim().toUpperCase()]
    );
    return resultado.rows[0] ? mapearVehiculo(resultado.rows[0]) : undefined;
  }

  async listar(): Promise<Vehiculo[]> {
    const resultado = await this.pool.query<FilaVehiculo>(
      "SELECT id, patente, tipo_vehiculo, marca, modelo, anio_fabricacion, color, capacidad_pasajeros, estado, created_at, updated_at FROM vehiculo ORDER BY created_at ASC"
    );
    return resultado.rows.map(mapearVehiculo);
  }

  async asignarAChofer(usuarioChoferId: string, vehiculoId: string, asignacionId: string, ahora: Date): Promise<AsignacionVehiculo> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query(
        "UPDATE chofer_vehiculo SET estado_asignacion = 'INACTIVA', desasignado_at = $2 WHERE usuario_chofer_id = $1 AND estado_asignacion = 'ACTIVA'",
        [usuarioChoferId, ahora]
      );
      const resultado = await cliente.query<FilaAsignacion>(
        `INSERT INTO chofer_vehiculo (id, usuario_chofer_id, vehiculo_id, estado_asignacion, asignado_at)
         VALUES ($1, $2, $3, 'ACTIVA', $4)
         RETURNING id, usuario_chofer_id, vehiculo_id, estado_asignacion, asignado_at, desasignado_at`,
        [asignacionId, usuarioChoferId, vehiculoId, ahora]
      );
      await cliente.query("COMMIT");
      return mapearAsignacion(resultado.rows[0]);
    } catch (error) {
      await cliente.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  async obtenerVehiculoActivoDeChofer(usuarioChoferId: string): Promise<Vehiculo | undefined> {
    const resultado = await this.pool.query<FilaVehiculo>(
      `SELECT v.id, v.patente, v.tipo_vehiculo, v.marca, v.modelo, v.anio_fabricacion, v.color, v.capacidad_pasajeros, v.estado, v.created_at, v.updated_at
       FROM chofer_vehiculo cv
       INNER JOIN vehiculo v ON v.id = cv.vehiculo_id
       WHERE cv.usuario_chofer_id = $1 AND cv.estado_asignacion = 'ACTIVA'
       LIMIT 1`,
      [usuarioChoferId]
    );
    return resultado.rows[0] ? mapearVehiculo(resultado.rows[0]) : undefined;
  }
}

export function crearPoolPostgres(env: NodeJS.ProcessEnv = process.env): Pool {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para ms-flota.");
  const configuracion: PoolConfig = { connectionString: databaseUrl, max: Number(env.DATABASE_POOL_MAX ?? 10) };
  return new Pool(configuracion);
}
