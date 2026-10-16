import { Pool, type PoolConfig } from "pg";
import { distanciaHaversineMetros, type Chofer, type ChoferCercano, type Coordenada, type RepositorioChoferes, type RepositorioUbicaciones, type UbicacionActual } from "./dominio";

type FilaChofer = {
  id: string; usuario_id: string; habilitado: boolean; disponibilidad: boolean;
  carnet_conducir_validado: boolean; fecha_creacion: Date; fecha_actualizacion: Date;
};
type FilaUbicacion = { id: string; usuario_id: string; latitud: string; longitud: string; actualizado_at: Date; precision_metros: string | null };

function mapearChofer(fila: FilaChofer): Chofer {
  return { id: fila.id, usuarioId: fila.usuario_id, habilitado: fila.habilitado, disponibilidad: fila.disponibilidad, carnetConducirValidado: fila.carnet_conducir_validado, fechaCreacion: new Date(fila.fecha_creacion), fechaActualizacion: new Date(fila.fecha_actualizacion) };
}
function mapearUbicacion(fila: FilaUbicacion): UbicacionActual {
  return { id: fila.id, usuarioId: fila.usuario_id, latitud: Number(fila.latitud), longitud: Number(fila.longitud), actualizadoAt: new Date(fila.actualizado_at), precisionMetros: fila.precision_metros === null ? undefined : Number(fila.precision_metros) };
}

export class RepositorioChoferesPostgres implements RepositorioChoferes {
  constructor(private readonly pool: Pool) {}

  async obtenerPorUsuario(usuarioId: string): Promise<Chofer | undefined> {
    const resultado = await this.pool.query<FilaChofer>("SELECT id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado, fecha_creacion, fecha_actualizacion FROM usuario_chofer WHERE usuario_id = $1", [usuarioId]);
    return resultado.rows[0] ? mapearChofer(resultado.rows[0]) : undefined;
  }

  async guardar(chofer: Chofer): Promise<Chofer> {
    const resultado = await this.pool.query<FilaChofer>(`UPDATE usuario_chofer SET habilitado = $2, disponibilidad = $3, carnet_conducir_validado = $4, fecha_actualizacion = $5 WHERE usuario_id = $1 RETURNING id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado, fecha_creacion, fecha_actualizacion`, [chofer.usuarioId, chofer.habilitado, chofer.disponibilidad, chofer.carnetConducirValidado, chofer.fechaActualizacion]);
    if (!resultado.rows[0]) throw new Error("El perfil de chofer no existe.");
    return mapearChofer(resultado.rows[0]);
  }

  async buscarDisponiblesCercanos(origen: Coordenada, radioMetros: number, ahora: Date, antiguedadMaximaMs: number): Promise<ChoferCercano[]> {
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
        AND u.actualizado_at >= $4 - ($5 * INTERVAL '1 millisecond')
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
}

export function crearPoolPostgres(env: NodeJS.ProcessEnv = process.env): Pool {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para ms-flota.");
  const configuracion: PoolConfig = { connectionString: databaseUrl, max: Number(env.DATABASE_POOL_MAX ?? 10) };
  return new Pool(configuracion);
}
