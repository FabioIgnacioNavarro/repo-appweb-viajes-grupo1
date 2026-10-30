-- Esquema de ms-viajes (ADR 0033, 0034 y 0026).
-- Es idempotente: puede aplicarse varias veces sobre la misma base.
-- Los ids de usuario son TEXT porque vienen del JWT externo (no se asume que sean UUID).
-- No hay claves foráneas hacia tablas de otros servicios: cada servicio solo escribe en lo suyo.

CREATE SCHEMA IF NOT EXISTS viajes;

-- Un viaje nace SOLICITADO al confirmar una estimación. El precio y los factores quedan congelados:
-- ninguna operación posterior recalcula precio_estimado, multiplicador_demanda ni factores_precio.
CREATE TABLE IF NOT EXISTS viajes.viaje (
  id TEXT PRIMARY KEY,
  pasajero_usuario_id TEXT NOT NULL,
  chofer_usuario_id TEXT NULL,
  estimacion_id TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN (
    'SOLICITADO', 'ASIGNADO', 'CHOFER_EN_CAMINO', 'EN_CURSO', 'FINALIZADO',
    'CANCELADO_POR_PASAJERO', 'CANCELADO_POR_CHOFER', 'CANCELADO_POR_OPERADOR',
    'SIN_CHOFERES_DISPONIBLES'
  )),
  origen_latitud NUMERIC(9,6) NOT NULL CHECK (origen_latitud BETWEEN -90 AND 90),
  origen_longitud NUMERIC(9,6) NOT NULL CHECK (origen_longitud BETWEEN -180 AND 180),
  destino_latitud NUMERIC(9,6) NOT NULL CHECK (destino_latitud BETWEEN -90 AND 90),
  destino_longitud NUMERIC(9,6) NOT NULL CHECK (destino_longitud BETWEEN -180 AND 180),
  -- Importes en pesos enteros sin centavos (ADR 0007). Nunca se convierten a number en JavaScript.
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda = 'ARS'),
  precio_estimado BIGINT NOT NULL CHECK (precio_estimado >= 0),
  precio_final BIGINT NULL CHECK (precio_final >= 0),
  multiplicador_demanda NUMERIC(8,4) NOT NULL CHECK (multiplicador_demanda > 0),
  -- Fotografía auditable de los factores de la estimación (zona, lluvia, franja, versión de regla...).
  factores_precio JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL,
  asignado_en TIMESTAMPTZ NULL,
  iniciado_en TIMESTAMPTZ NULL,
  finalizado_en TIMESTAMPTZ NULL,
  cancelado_en TIMESTAMPTZ NULL,
  motivo_cancelacion TEXT NULL,
  fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Un viaje en estos estados siempre tiene chofer.
  CONSTRAINT ck_viaje_chofer_si_asignado CHECK (
    estado NOT IN ('ASIGNADO', 'CHOFER_EN_CAMINO', 'EN_CURSO', 'FINALIZADO')
    OR chofer_usuario_id IS NOT NULL
  ),
  -- Solo un viaje finalizado tiene precio final.
  CONSTRAINT ck_viaje_precio_final_si_finalizado CHECK (precio_final IS NULL OR estado = 'FINALIZADO'),
  -- cancelado_en existe si y solo si el viaje está cancelado.
  CONSTRAINT ck_viaje_cancelacion_coherente CHECK (
    (estado IN ('CANCELADO_POR_PASAJERO', 'CANCELADO_POR_CHOFER', 'CANCELADO_POR_OPERADOR'))
    = (cancelado_en IS NOT NULL)
  )
);

-- Invariante central (ADR 0033): un chofer no puede tener dos viajes activos.
-- Es un índice único PARCIAL: solo cuenta las filas cuyo estado ocupa al chofer. Si dos
-- transacciones intentan asignar el mismo chofer, la segunda falla con el código 23505.
CREATE UNIQUE INDEX IF NOT EXISTS ux_viaje_chofer_activo
  ON viajes.viaje (chofer_usuario_id)
  WHERE estado IN ('ASIGNADO', 'CHOFER_EN_CAMINO', 'EN_CURSO');

CREATE INDEX IF NOT EXISTS ix_viaje_pasajero_creado ON viajes.viaje (pasajero_usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_viaje_chofer_creado ON viajes.viaje (chofer_usuario_id, creado_en DESC)
  WHERE chofer_usuario_id IS NOT NULL;
-- Sirve a GET /interno/demanda-por-zona: cuenta viajes SOLICITADO por zona.
CREATE INDEX IF NOT EXISTS ix_viaje_solicitado_zona ON viajes.viaje ((factores_precio ->> 'zona_id'))
  WHERE estado = 'SOLICITADO';

-- Una oferta es una propuesta de un viaje a un chofer concreto, con vencimiento.
CREATE TABLE IF NOT EXISTS viajes.oferta (
  id TEXT PRIMARY KEY,
  viaje_id TEXT NOT NULL REFERENCES viajes.viaje (id),
  chofer_usuario_id TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN (
    'PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA', 'NO_SELECCIONADA'
  )),
  enviada_en TIMESTAMPTZ NOT NULL,
  expira_en TIMESTAMPTZ NOT NULL,
  respondida_en TIMESTAMPTZ NULL,
  fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_oferta_vigencia CHECK (expira_en > enviada_en),
  CONSTRAINT ck_oferta_pendiente_sin_respuesta CHECK (estado <> 'PENDIENTE' OR respondida_en IS NULL),
  -- Un chofer recibe como máximo una oferta por viaje: permite reanudar el matching sin duplicar.
  CONSTRAINT ux_oferta_viaje_chofer UNIQUE (viaje_id, chofer_usuario_id)
);

-- Red de seguridad: un viaje no puede tener dos ofertas aceptadas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_oferta_aceptada_por_viaje
  ON viajes.oferta (viaje_id)
  WHERE estado = 'ACEPTADA';

CREATE INDEX IF NOT EXISTS ix_oferta_chofer_estado ON viajes.oferta (chofer_usuario_id, estado, expira_en);

-- Cobro simulado. UNIQUE (viaje_id) garantiza la invariante 13: un viaje se cobra una sola vez,
-- aunque la finalización se reintente o llegue duplicada.
CREATE TABLE IF NOT EXISTS viajes.cobro (
  id TEXT PRIMARY KEY,
  viaje_id TEXT NOT NULL UNIQUE REFERENCES viajes.viaje (id),
  importe BIGINT NOT NULL CHECK (importe >= 0),
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda = 'ARS'),
  estado TEXT NOT NULL CHECK (estado IN ('CONFIRMADO')),
  creado_en TIMESTAMPTZ NOT NULL
);

-- Idempotencia: la clave pertenece al actor y a la intención (operacion). Un reintento con la misma
-- clave y la misma huella devuelve el resultado guardado; con otra huella es un conflicto, no un
-- segundo efecto. La huella es un hash del cuerpo de la solicitud, calculado por la aplicación.
CREATE TABLE IF NOT EXISTS viajes.idempotencia (
  actor_id TEXT NOT NULL,
  operacion TEXT NOT NULL,
  clave TEXT NOT NULL,
  huella_solicitud TEXT NOT NULL,
  resultado JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
  PRIMARY KEY (actor_id, operacion, clave)
);

CREATE INDEX IF NOT EXISTS ix_idempotencia_expira ON viajes.idempotencia (expira_en);
