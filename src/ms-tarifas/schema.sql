CREATE SCHEMA IF NOT EXISTS tarifa;

CREATE TABLE IF NOT EXISTS tarifa.regla_tarifa (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  tarifa_base_pesos BIGINT NOT NULL CHECK (tarifa_base_pesos >= 0),
  precio_por_kilometro_pesos BIGINT NOT NULL CHECK (precio_por_kilometro_pesos >= 0),
  precio_por_minuto_pesos BIGINT NOT NULL CHECK (precio_por_minuto_pesos >= 0),
  multiplicador_minimo_escalado INTEGER NOT NULL CHECK (multiplicador_minimo_escalado > 0),
  multiplicador_maximo_escalado INTEGER NOT NULL CHECK (multiplicador_maximo_escalado >= multiplicador_minimo_escalado),
  factores JSONB NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_regla_tarifa_activa ON tarifa.regla_tarifa (activa) WHERE activa = TRUE;

INSERT INTO tarifa.regla_tarifa (version, tarifa_base_pesos, precio_por_kilometro_pesos, precio_por_minuto_pesos, multiplicador_minimo_escalado, multiplicador_maximo_escalado, factores)
VALUES (1, 1000, 600, 120, 7500, 20000,
  '{"lluvia_con_precipitacion_escalado":11000,"lluvia_sin_precipitacion_escalado":10000,"disponibilidad":[{"hasta":0,"multiplicadorEscalado":13000},{"hasta":2,"multiplicadorEscalado":12000},{"hasta":5,"multiplicadorEscalado":11000},{"hasta":11,"multiplicadorEscalado":10000},{"hasta":9007199254740991,"multiplicadorEscalado":9000}],"demanda_por_mil":[{"hasta":999,"multiplicadorEscalado":10000},{"hasta":1999,"multiplicadorEscalado":11000},{"hasta":2999,"multiplicadorEscalado":12000},{"hasta":9007199254740991,"multiplicadorEscalado":13000}],"horario":{"MADRUGADA":10000,"MANANA":10000,"SIESTA":9500,"TARDE":10500,"NOCHE":11000}}'::jsonb)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS tarifa.zona_tarifaria (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  latitud_minima NUMERIC(9,6) NOT NULL,
  latitud_maxima NUMERIC(9,6) NOT NULL,
  longitud_minima NUMERIC(9,6) NOT NULL,
  longitud_maxima NUMERIC(9,6) NOT NULL,
  latitud_centro NUMERIC(9,6) NOT NULL,
  longitud_centro NUMERIC(9,6) NOT NULL,
  radio_metros INTEGER NOT NULL CHECK (radio_metros BETWEEN 1 AND 100000),
  zona_horaria TEXT NOT NULL,
  prioridad INTEGER NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (latitud_minima < latitud_maxima AND longitud_minima < longitud_maxima)
);
INSERT INTO tarifa.zona_tarifaria (id,nombre,latitud_minima,latitud_maxima,longitud_minima,longitud_maxima,latitud_centro,longitud_centro,radio_metros,zona_horaria,prioridad)
VALUES ('resistencia','Resistencia',-27.60,-27.30,-59.15,-58.75,-27.45,-58.98,15000,'America/Argentina/Buenos_Aires',1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS tarifa.estimacion (
  id UUID PRIMARY KEY,
  pasajero_id TEXT NOT NULL,
  origen_latitud NUMERIC(9,6) NOT NULL CHECK (origen_latitud BETWEEN -90 AND 90),
  origen_longitud NUMERIC(9,6) NOT NULL CHECK (origen_longitud BETWEEN -180 AND 180),
  destino_latitud NUMERIC(9,6) NOT NULL CHECK (destino_latitud BETWEEN -90 AND 90),
  destino_longitud NUMERIC(9,6) NOT NULL CHECK (destino_longitud BETWEEN -180 AND 180),
  zona_id TEXT NOT NULL REFERENCES tarifa.zona_tarifaria(id),
  precio_estimado BIGINT NOT NULL CHECK (precio_estimado >= 0),
  distancia_metros INTEGER NOT NULL CHECK (distancia_metros >= 0),
  duracion_segundos INTEGER NOT NULL CHECK (duracion_segundos >= 0),
  proveedor_ruta TEXT NOT NULL CHECK (proveedor_ruta IN ('OSRM','GOOGLE','HAVERSINE')),
  polilinea TEXT,
  multiplicador_demanda_escalado INTEGER NOT NULL,
  factores_precio JSONB NOT NULL,
  version_regla INTEGER NOT NULL REFERENCES tarifa.regla_tarifa(version),
  creada_en TIMESTAMPTZ NOT NULL,
  vigente_hasta TIMESTAMPTZ NOT NULL CHECK (vigente_hasta > creada_en)
);
CREATE INDEX IF NOT EXISTS ix_estimacion_pasajero_vigencia ON tarifa.estimacion (pasajero_id, vigente_hasta);
