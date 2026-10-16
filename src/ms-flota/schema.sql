CREATE TABLE IF NOT EXISTS usuario_chofer (
  id UUID PRIMARY KEY,
  usuario_id UUID NOT NULL UNIQUE,
  habilitado BOOLEAN NOT NULL DEFAULT FALSE,
  disponibilidad BOOLEAN NOT NULL DEFAULT FALSE,
  carnet_conducir_validado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ubicacion_actual (
  id UUID PRIMARY KEY,
  usuario_id UUID NOT NULL UNIQUE,
  latitud NUMERIC(9,6) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
  longitud NUMERIC(9,6) NOT NULL CHECK (longitud BETWEEN -180 AND 180),
  actualizado_at TIMESTAMPTZ NOT NULL,
  precision_metros NUMERIC(10,2) CHECK (precision_metros IS NULL OR precision_metros >= 0)
);

CREATE INDEX IF NOT EXISTS ix_ubicacion_actual_coordenadas ON ubicacion_actual (latitud, longitud);
CREATE INDEX IF NOT EXISTS ix_ubicacion_actual_actualizado ON ubicacion_actual (actualizado_at);

CREATE TABLE IF NOT EXISTS ubicacion_historica (
  id UUID PRIMARY KEY,
  usuario_id UUID NOT NULL,
  viaje_id UUID NULL,
  latitud NUMERIC(9,6) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
  longitud NUMERIC(9,6) NOT NULL CHECK (longitud BETWEEN -180 AND 180),
  registrado_at TIMESTAMPTZ NOT NULL,
  precision_metros NUMERIC(10,2) CHECK (precision_metros IS NULL OR precision_metros >= 0)
);

CREATE INDEX IF NOT EXISTS ix_ubicacion_historica_usuario_fecha ON ubicacion_historica (usuario_id, registrado_at DESC);
CREATE INDEX IF NOT EXISTS ix_ubicacion_historica_viaje_fecha ON ubicacion_historica (viaje_id, registrado_at DESC);

-- Datos de prueba reproducibles; no son credenciales ni datos personales.
INSERT INTO usuario_chofer (id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado)
VALUES ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', TRUE, FALSE, TRUE)
ON CONFLICT (usuario_id) DO NOTHING;
