import { randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import {
  ErrorDominio,
  estadosOrigenPermitidos,
  type AsignadorAtomico,
  type Cobro,
  type EjecutorIdempotente,
  type EstadoCobro,
  type EstadoOferta,
  type EstadoViaje,
  type GeneradorId,
  type Oferta,
  type FiltrosListadoViajes,
  type RepositorioCobros,
  type RepositorioIdempotencia,
  type RepositorioOfertas,
  type RepositorioViajes,
  type RepositoriosConfirmacionTransaccionales,
  type RepositoriosViajeTransaccionales,
  type TransaccionViajes,
  type Viaje
} from "./dominio";

export type EjecutorSql = {
  query: Pool["query"];
};

type FilaViaje = {
  id: string;
  pasajero_usuario_id: string;
  chofer_usuario_id: string | null;
  estimacion_id: string;
  estado: string;
  origen_latitud: string;
  origen_longitud: string;
  destino_latitud: string;
  destino_longitud: string;
  origen_direccion: string | null;
  destino_direccion: string | null;
  moneda: string;
  precio_estimado: string;
  precio_final: string | null;
  multiplicador_demanda: string;
  factores_precio: Record<string, unknown>;
  creado_en: Date;
  asignado_en: Date | null;
  iniciado_en: Date | null;
  finalizado_en: Date | null;
  cancelado_en: Date | null;
  motivo_cancelacion: string | null;
  fecha_actualizacion: Date;
};

type FilaOferta = {
  id: string;
  viaje_id: string;
  chofer_usuario_id: string;
  estado: string;
  enviada_en: Date;
  expira_en: Date;
  respondida_en: Date | null;
  fecha_actualizacion: Date;
};

type FilaCobro = {
  id: string;
  viaje_id: string;
  importe: string;
  moneda: string;
  estado: string;
  intentos: number;
  creado_en: Date;
};

type FilaIdempotencia = {
  actor_id: string;
  operacion: string;
  clave: string;
  huella_solicitud: string;
  resultado: unknown;
  creado_en: Date;
  expira_en: Date;
};

function filtrosSqlViajes(filtros: Omit<FiltrosListadoViajes, "limite" | "desplazamiento"> = {}): { where: string; valores: unknown[] } {
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  if (filtros.participanteId) {
    valores.push(filtros.participanteId);
    condiciones.push(`(pasajero_usuario_id = $${valores.length} OR chofer_usuario_id = $${valores.length})`);
  }
  if (filtros.estado) { valores.push(filtros.estado); condiciones.push(`estado = $${valores.length}`); }
  if (filtros.desde) { valores.push(filtros.desde); condiciones.push(`creado_en >= $${valores.length}`); }
  if (filtros.hasta) { valores.push(filtros.hasta); condiciones.push(`creado_en < $${valores.length}`); }
  return { where: condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "", valores };
}

function mapearViaje(fila: FilaViaje): Viaje {
  const factores = typeof fila.factores_precio === "string"
    ? JSON.parse(fila.factores_precio)
    : (fila.factores_precio ?? {});
  return {
    id: fila.id,
    pasajeroId: fila.pasajero_usuario_id,
    choferId: fila.chofer_usuario_id ?? undefined,
    origen: {
      latitud: Number(fila.origen_latitud),
      longitud: Number(fila.origen_longitud),
      ...(fila.origen_direccion ? { direccion: fila.origen_direccion } : {})
    },
    destino: {
      latitud: Number(fila.destino_latitud),
      longitud: Number(fila.destino_longitud),
      ...(fila.destino_direccion ? { direccion: fila.destino_direccion } : {})
    },
    estimacionId: fila.estimacion_id,
    precioEstimado: fila.precio_estimado, // BIGINT en pg viene como string exacto (ADR 0007)
    precioFinal: fila.precio_final ?? undefined,
    moneda: "ARS",
    multiplicadorDemanda: Number(fila.multiplicador_demanda),
    factoresPrecio: typeof factores === "object" && factores !== null ? (factores as Record<string, unknown>) : {},
    estado: fila.estado as EstadoViaje,
    creadoEn: new Date(fila.creado_en),
    iniciadoEm: fila.iniciado_en ? new Date(fila.iniciado_en) : undefined,
    finalizadoEm: fila.finalizado_en ? new Date(fila.finalizado_en) : undefined,
    canceladoEm: fila.cancelado_en ? new Date(fila.cancelado_en) : undefined,
    motivoCancelacion: fila.motivo_cancelacion ?? undefined
  };
}

function mapearOferta(fila: FilaOferta): Oferta {
  return {
    id: fila.id,
    viajeId: fila.viaje_id,
    choferId: fila.chofer_usuario_id,
    estado: fila.estado as EstadoOferta,
    enviadaEm: new Date(fila.enviada_en),
    expiraEm: new Date(fila.expira_en),
    respondidaEm: fila.respondida_en ? new Date(fila.respondida_en) : undefined
  };
}

function mapearCobro(fila: FilaCobro): Cobro {
  return {
    id: fila.id,
    viajeId: fila.viaje_id,
    importe: fila.importe,
    moneda: "ARS",
    estado: fila.estado as EstadoCobro,
    intentos: fila.intentos,
    creadoEn: new Date(fila.creado_en)
  };
}

export class RepositorioViajesPostgres implements RepositorioViajes {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async obtenerParaActualizar(id: string): Promise<Viaje | undefined> {
    const resultado = await this.ejecutor.query<FilaViaje>(
      "SELECT * FROM viajes.viaje WHERE id = $1 FOR UPDATE",
      [id]
    );
    return resultado.rows[0] ? mapearViaje(resultado.rows[0]) : undefined;
  }

  async guardar(viaje: Viaje): Promise<Viaje> {
    try {
      const existe = await this.ejecutor.query("SELECT estado FROM viajes.viaje WHERE id = $1", [viaje.id]);
      if ((existe.rowCount ?? 0) === 0) {
        // Inserción inicial de un viaje nuevo
        const resultado = await this.ejecutor.query<FilaViaje>(
          `INSERT INTO viajes.viaje (
            id, pasajero_usuario_id, chofer_usuario_id, estimacion_id, estado,
            origen_latitud, origen_longitud, destino_latitud, destino_longitud,
            origen_direccion, destino_direccion,
            moneda, precio_estimado, precio_final, multiplicador_demanda, factores_precio,
            creado_en, asignado_en, iniciado_en, finalizado_en, cancelado_en, motivo_cancelacion, fecha_actualizacion
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11,
            $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, CURRENT_TIMESTAMP
          )
          RETURNING *`,
          [
            viaje.id,
            viaje.pasajeroId,
            viaje.choferId ?? null,
            viaje.estimacionId,
            viaje.estado,
            viaje.origen.latitud,
            viaje.origen.longitud,
            viaje.destino.latitud,
            viaje.destino.longitud,
            viaje.origen.direccion ?? null,
            viaje.destino.direccion ?? null,
            viaje.moneda,
            viaje.precioEstimado,
            viaje.precioFinal ?? null,
            viaje.multiplicadorDemanda,
            JSON.stringify(viaje.factoresPrecio),
            viaje.creadoEn,
            viaje.choferId ? new Date() : null,
            viaje.iniciadoEm ?? null,
            viaje.finalizadoEm ?? null,
            viaje.canceladoEm ?? null,
            viaje.motivoCancelacion ?? null
          ]
        );
        return mapearViaje(resultado.rows[0]);
      }

      // La matriz de dominio también limita el UPDATE condicional para impedir saltos concurrentes.
      const estadosAnteriores = estadosOrigenPermitidos(viaje.estado);
      if (estadosAnteriores.length === 0) throw new ErrorDominio("TRANSICION_ESTADO_INVALIDA", "El estado solicitado es terminal y no admite transiciones.");

      const resultado = await this.ejecutor.query<FilaViaje>(
        `UPDATE viajes.viaje SET
          chofer_usuario_id = COALESCE($2, chofer_usuario_id),
          estado = $3,
          precio_final = CASE WHEN $3 = 'FINALIZADO' THEN COALESCE($4, precio_final) ELSE NULL END,
          asignado_en = CASE WHEN $2 IS NOT NULL AND asignado_en IS NULL THEN CURRENT_TIMESTAMP ELSE asignado_en END,
          iniciado_en = COALESCE($5, iniciado_en),
          finalizado_en = COALESCE($6, finalizado_en),
          cancelado_en = CASE WHEN $3 IN ('CANCELADO_POR_PASAJERO', 'CANCELADO_POR_CHOFER', 'CANCELADO_POR_OPERADOR') THEN COALESCE($7, CURRENT_TIMESTAMP) ELSE NULL END,
          motivo_cancelacion = COALESCE($8, motivo_cancelacion),
          fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id = $1 AND estado = ANY($9::text[])
        RETURNING *`,
        [
          viaje.id,
          viaje.choferId ?? null,
          viaje.estado,
          viaje.precioFinal ?? null,
          viaje.iniciadoEm ?? null,
          viaje.finalizadoEm ?? null,
          viaje.canceladoEm ?? null,
          viaje.motivoCancelacion ?? null,
          estadosAnteriores
        ]
      );

      if ((resultado.rowCount ?? 0) === 0) {
        throw new ErrorDominio("TRANSICION_ESTADO_INVALIDA", "La transición solicitada no es válida para el estado actual.");
      }

      return mapearViaje(resultado.rows[0]);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") {
        throw new ErrorDominio("ASIGNACION_EN_CONFLICTO", "El chofer ya tiene un viaje activo.");
      }
      throw error;
    }
  }

  async obtener(id: string): Promise<Viaje | undefined> {
    const resultado = await this.ejecutor.query<FilaViaje>(
      "SELECT * FROM viajes.viaje WHERE id = $1",
      [id]
    );
    return resultado.rows[0] ? mapearViaje(resultado.rows[0]) : undefined;
  }

  async obtenerActivoPorChofer(idChofer: string): Promise<Viaje | undefined> {
    const resultado = await this.ejecutor.query<FilaViaje>(
      "SELECT * FROM viajes.viaje WHERE chofer_usuario_id = $1 AND estado IN ('ASIGNADO', 'CHOFER_EN_CAMINO', 'EN_CURSO') LIMIT 1",
      [idChofer]
    );
    return resultado.rows[0] ? mapearViaje(resultado.rows[0]) : undefined;
  }

  async listar(filtros: FiltrosListadoViajes = {}): Promise<Viaje[]> {
    const consulta = filtrosSqlViajes(filtros);
    const valores = [...consulta.valores];
    let paginacion = "";
    if (filtros.limite !== undefined) {
      valores.push(filtros.limite);
      paginacion += ` LIMIT $${valores.length}`;
    }
    if (filtros.desplazamiento !== undefined) {
      valores.push(filtros.desplazamiento);
      paginacion += ` OFFSET $${valores.length}`;
    }
    const resultado = await this.ejecutor.query<FilaViaje>(
      `SELECT * FROM viajes.viaje ${consulta.where} ORDER BY creado_en DESC${paginacion}`,
      valores
    );
    return resultado.rows.map(mapearViaje);
  }

  async contar(filtros: Omit<FiltrosListadoViajes, "limite" | "desplazamiento"> = {}): Promise<number> {
    const consulta = filtrosSqlViajes(filtros);
    const resultado = await this.ejecutor.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM viajes.viaje ${consulta.where}`,
      consulta.valores
    );
    return Number(resultado.rows[0]?.total ?? "0");
  }
}

export class RepositorioOfertasPostgres implements RepositorioOfertas {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async obtenerParaActualizar(id: string): Promise<Oferta | undefined> {
    const resultado = await this.ejecutor.query<FilaOferta>(
      "SELECT * FROM viajes.oferta WHERE id = $1 FOR UPDATE",
      [id]
    );
    return resultado.rows[0] ? mapearOferta(resultado.rows[0]) : undefined;
  }

  async guardar(oferta: Oferta): Promise<Oferta> {
    try {
      const resultado = await this.ejecutor.query<FilaOferta>(
        `INSERT INTO viajes.oferta (
          id, viaje_id, chofer_usuario_id, estado, enviada_en, expira_en, respondida_en, fecha_actualizacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET
          estado = EXCLUDED.estado,
          respondida_en = EXCLUDED.respondida_en,
          fecha_actualizacion = CURRENT_TIMESTAMP
        RETURNING *`,
        [
          oferta.id,
          oferta.viajeId,
          oferta.choferId,
          oferta.estado,
          oferta.enviadaEm,
          oferta.expiraEm,
          oferta.respondidaEm ?? null
        ]
      );
      return mapearOferta(resultado.rows[0]);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") {
        throw new ErrorDominio("ASIGNACION_EN_CONFLICTO", "El viaje ya tiene una oferta aceptada o el chofer ya recibió una oferta.");
      }
      throw error;
    }
  }

  async obtener(id: string): Promise<Oferta | undefined> {
    const resultado = await this.ejecutor.query<FilaOferta>(
      "SELECT * FROM viajes.oferta WHERE id = $1",
      [id]
    );
    return resultado.rows[0] ? mapearOferta(resultado.rows[0]) : undefined;
  }

  async listarPorChofer(choferId: string): Promise<Oferta[]> {
    const resultado = await this.ejecutor.query<FilaOferta>(
      "SELECT * FROM viajes.oferta WHERE chofer_usuario_id = $1 ORDER BY enviada_en DESC",
      [choferId]
    );
    return resultado.rows.map(mapearOferta);
  }

  async listarPorViaje(viajeId: string): Promise<Oferta[]> {
    const resultado = await this.ejecutor.query<FilaOferta>(
      "SELECT * FROM viajes.oferta WHERE viaje_id = $1 ORDER BY enviada_en DESC",
      [viajeId]
    );
    return resultado.rows.map(mapearOferta);
  }
}

export class RepositorioCobrosPostgres implements RepositorioCobros {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async guardar(cobro: Cobro): Promise<Cobro> {
    const resultado = await this.ejecutor.query<FilaCobro>(
      `INSERT INTO viajes.cobro AS cobro_actual (id, viaje_id, importe, moneda, estado, intentos, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (viaje_id) DO UPDATE SET
         estado = CASE WHEN cobro_actual.estado = 'CONFIRMADO' THEN 'CONFIRMADO' ELSE EXCLUDED.estado END,
         intentos = GREATEST(cobro_actual.intentos, EXCLUDED.intentos)
       RETURNING *`,
      [cobro.id, cobro.viajeId, cobro.importe, cobro.moneda, cobro.estado, cobro.intentos, cobro.creadoEn]
    );
    return mapearCobro(resultado.rows[0]);
  }

  async obtenerPorViaje(viajeId: string): Promise<Cobro | undefined> {
    const resultado = await this.ejecutor.query<FilaCobro>(
      "SELECT * FROM viajes.cobro WHERE viaje_id = $1",
      [viajeId]
    );
    return resultado.rows[0] ? mapearCobro(resultado.rows[0]) : undefined;
  }
}

export class RepositorioIdempotenciaPostgres implements RepositorioIdempotencia {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async obtener(actorId: string, clave: string, operacion = "confirmar_viaje"): Promise<unknown | undefined> {
    const resultado = await this.ejecutor.query<FilaIdempotencia>(
      "SELECT resultado FROM viajes.idempotencia WHERE actor_id = $1 AND operacion = $2 AND clave = $3 AND expira_en > CURRENT_TIMESTAMP",
      [actorId, operacion, clave]
    );
    const data = resultado.rows[0]?.resultado;
    if (data && typeof data === "object") {
      const v = data as Record<string, unknown>;
      if (typeof v.creadoEn === "string") v.creadoEn = new Date(v.creadoEn);
      if (typeof v.iniciadoEm === "string") v.iniciadoEm = new Date(v.iniciadoEm);
      if (typeof v.finalizadoEm === "string") v.finalizadoEm = new Date(v.finalizadoEm);
      if (typeof v.canceladoEm === "string") v.canceladoEm = new Date(v.canceladoEm);
      if (typeof v.creadoEn === "string") v.creadoEn = new Date(v.creadoEn);
    }
    return data;
  }

  async guardar(actorId: string, clave: string, resultado: unknown, operacion = "confirmar_viaje"): Promise<void> {
    await this.ejecutor.query(
      `INSERT INTO viajes.idempotencia (actor_id, operacion, clave, huella_solicitud, resultado, creado_en, expira_en)
       VALUES ($1, $2, $3, 'huella', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '24 hours')
       ON CONFLICT (actor_id, operacion, clave) DO UPDATE SET resultado = EXCLUDED.resultado`,
      [actorId, operacion, clave, JSON.stringify(resultado)]
    );
  }
}

export class GeneradorIdUuid implements GeneradorId {
  generar(prefijo: string): string {
    return `${prefijo}-${randomUUID()}`;
  }
}

/** Ejecuta confirmaciones serializando por actor, operación y clave con lock transaccional en PostgreSQL. */
export class EjecutorIdempotentePostgres implements EjecutorIdempotente {
  constructor(private readonly pool: Pool) {}

  async ejecutar<T>(
    actorId: string,
    clave: string,
    operacion: string,
    trabajo: (repositorios: RepositoriosConfirmacionTransaccionales) => Promise<T>
  ): Promise<T> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [`${actorId}:${operacion}`, clave]
      );
      const resultado = await trabajo({
        viajes: new RepositorioViajesPostgres(cliente),
        idempotencia: new RepositorioIdempotenciaPostgres(cliente)
      });
      await cliente.query("COMMIT");
      return resultado;
    } catch (error) {
      try { await cliente.query("ROLLBACK"); } catch { /* Conserva el error original que provocó el rollback. */ }
      throw error;
    } finally {
      cliente.release();
    }
  }
}

/** Ejecuta escrituras coordinadas de viajes y ofertas en una transacción PostgreSQL local. */
export class TransaccionesViajesPostgres implements TransaccionViajes {
  constructor(private readonly pool: Pool) {}

  async ejecutar<T>(operacion: (repositorios: RepositoriosViajeTransaccionales) => Promise<T>): Promise<T> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query("BEGIN");
      const repositorios: RepositoriosViajeTransaccionales = {
        viajes: new RepositorioViajesPostgres(cliente),
        ofertas: new RepositorioOfertasPostgres(cliente)
      };
      const resultado = await operacion(repositorios);
      await cliente.query("COMMIT");
      return resultado;
    } catch (error: unknown) {
      try { await cliente.query("ROLLBACK"); } catch { /* Conserva el error que provocó el rollback. */ }
      if ((error as { code?: string }).code === "23505") {
        throw new ErrorDominio("ASIGNACION_EN_CONFLICTO", "El viaje o el chofer ya fueron asignados.");
      }
      throw error;
    } finally {
      cliente.release();
    }
  }
}

export class AsignadorAtomicoPostgres implements AsignadorAtomico {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async intentarAsignar(viajeId: string, choferId: string): Promise<boolean> {
    // 1. Verificar si el chofer ya tiene un viaje activo en la base de datos
    const choferOcupado = await this.ejecutor.query(
      `SELECT 1 FROM viajes.viaje 
       WHERE chofer_usuario_id = $1 
         AND estado IN ('ASIGNADO', 'CHOFER_EN_CAMINO', 'EN_CURSO') 
       LIMIT 1`,
      [choferId]
    );
    if ((choferOcupado.rowCount ?? 0) > 0) {
      return false;
    }

    // 2. Verificar si el viaje sigue en SOLICITADO
    const viajeDisponible = await this.ejecutor.query(
      `SELECT 1 FROM viajes.viaje
       WHERE id = $1 AND estado = 'SOLICITADO'
       LIMIT 1`,
      [viajeId]
    );
    if ((viajeDisponible.rowCount ?? 0) === 0) {
      return false;
    }

    return true;
  }

  async liberar(_viajeId: string, _choferId: string): Promise<void> {
    // En PostgreSQL, la exclusión del chofer está indexada exclusivamente
    // para estados activos por el índice único parcial 'ux_viaje_chofer_activo'.
    // Al pasar a FINALIZADO o CANCELADO_*, la liberación es inmediata y atómica.
  }
}

export class ConsultarDemandaPorZonaPostgres {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async ejecutar(zonaId: string): Promise<number> {
    const resultado = await this.ejecutor.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM viajes.viaje 
       WHERE estado = 'SOLICITADO' AND factores_precio ->> 'zona_id' = $1`,
      [zonaId]
    );
    return Number(resultado.rows[0]?.total ?? 0);
  }
}

export class ConsultarChoferesOcupadosPostgres {
  constructor(private readonly ejecutor: EjecutorSql) {}

  async ejecutar(idsChoferes: string[]): Promise<string[]> {
    if (idsChoferes.length === 0) return [];
    const resultado = await this.ejecutor.query<{ chofer_usuario_id: string }>(
      `SELECT DISTINCT chofer_usuario_id FROM viajes.viaje 
       WHERE chofer_usuario_id = ANY($1::text[]) 
         AND estado IN ('ASIGNADO', 'CHOFER_EN_CAMINO', 'EN_CURSO')`,
      [idsChoferes]
    );
    return resultado.rows.map((r) => r.chofer_usuario_id);
  }
}

export function crearPoolPostgres(env: NodeJS.ProcessEnv = process.env): Pool {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para ms-viajes.");
  const configuracion: PoolConfig = {
    connectionString: databaseUrl,
    max: Number(env.DATABASE_POOL_MAX ?? 10)
  };
  return new Pool(configuracion);
}
