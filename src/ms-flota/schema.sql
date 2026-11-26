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
CREATE INDEX IF NOT EXISTS ix_ubicacion_historica_registrado ON ubicacion_historica (registrado_at);

CREATE TABLE IF NOT EXISTS vehiculo (
  id UUID PRIMARY KEY,
  patente TEXT NOT NULL UNIQUE,
  tipo_vehiculo TEXT NOT NULL,
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  anio_fabricacion INTEGER NOT NULL CHECK (anio_fabricacion BETWEEN 1990 AND 2035),
  color TEXT NOT NULL,
  capacidad_pasajeros INTEGER NOT NULL CHECK (capacidad_pasajeros BETWEEN 1 AND 20),
  estado TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chofer_vehiculo (
  id UUID PRIMARY KEY,
  usuario_chofer_id UUID NOT NULL REFERENCES usuario_chofer (id),
  vehiculo_id UUID NOT NULL REFERENCES vehiculo (id),
  estado_asignacion TEXT NOT NULL CHECK (estado_asignacion IN ('ACTIVA', 'INACTIVA')),
  asignado_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  desasignado_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_chofer_vehiculo_activo
  ON chofer_vehiculo (usuario_chofer_id)
  WHERE estado_asignacion = 'ACTIVA';

-- Datos de prueba reproducibles; no son credenciales ni datos personales.
INSERT INTO usuario_chofer (id, usuario_id, habilitado, disponibilidad, carnet_conducir_validado)
VALUES
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', TRUE, FALSE, TRUE),
  ('99999999-9999-4999-8999-999999999999', '99999999-9999-4999-8999-999999999999', TRUE, FALSE, TRUE)
ON CONFLICT (usuario_id) DO NOTHING;

INSERT INTO vehiculo (id, patente, tipo_vehiculo, marca, modelo, anio_fabricacion, color, capacidad_pasajeros, estado)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'AA123BB', 'AUTOMOVIL', 'Toyota', 'Etios', 2023, 'Blanco', 4, 'ACTIVO')
ON CONFLICT (patente) DO NOTHING;

INSERT INTO chofer_vehiculo (id, usuario_chofer_id, vehiculo_id, estado_asignacion)
SELECT
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  v.id,
  'ACTIVA'
FROM vehiculo v
WHERE v.patente = 'AA123BB'
  AND NOT EXISTS (
    SELECT 1 FROM chofer_vehiculo cv
    WHERE cv.usuario_chofer_id = '11111111-1111-4111-8111-111111111111'
      AND cv.estado_asignacion = 'ACTIVA'
  );
