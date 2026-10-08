# Modelo de dominio

## Objetivo

La plataforma recibe una solicitud de viaje de un pasajero, calcula una estimación de precio, busca choferes habilitados y disponibles, les envía ofertas y registra el viaje hasta su finalización o cancelación.

La variante obligatoria del grupo es **A: precio dinámico por demanda**. El precio se calcula en el servidor con tarifa base, distancia, duración estimada y factores configurables de lluvia, disponibilidad, demanda y franja horaria.

## Decisiones generales del modelo

- `Persona` contiene los datos personales compartidos.
- Una `Persona` puede tener uno o varios registros en `Usuario`.
- Cada `Usuario` tiene exactamente un rol y ese rol no cambia durante su ciclo de vida.
- Las relaciones de negocio referencian `usuario.id`, no `usuario_chofer.id`.
- `UsuarioChofer` contiene únicamente información específica del perfil de chofer.
- No se crea `UsuarioPasajero` mientras el pasajero no tenga atributos propios adicionales.
- Todas las tablas tienen un `id` propio, según la convención del proyecto.

## Actores y roles

| Rol | Responsabilidad | Ubicación persistida |
|---|---|---|
| `PASAJERO` | Solicitar, confirmar, seguir y cancelar sus viajes | Puede tener ubicación |
| `CHOFER` | Gestionar disponibilidad, ubicación, ofertas y estados | Puede tener ubicación |
| `SOPORTE` | Visualizar viajes en curso y cancelar con motivo | No tiene ubicación |
| `ADMINISTRADOR` | Configurar parámetros y habilitar choferes | No tiene ubicación |

## Entidades de identidad y autenticación

### `persona`

```text
persona
-------
id PK
nombre_apellido
dni UNIQUE
fecha_nacimiento
estado_civil
telefono
correo UNIQUE
fecha_creacion
fecha_actualizacion
```

Una persona puede tener, por ejemplo, un usuario pasajero y otro usuario chofer. El correo pertenece a la persona y no se duplica por rol.

### `usuario`

```text
usuario
-------
id PK
persona_id FK -> persona.id
nombre_usuario UNIQUE
rol_usuario
estado
fecha_creacion
fecha_actualizacion
```

Valores iniciales de `rol_usuario`:

```text
PASAJERO
CHOFER
SOPORTE
ADMINISTRADOR
```

Restricción recomendada:

```text
UNIQUE(persona_id, rol_usuario)
```

### `credencial`

Existe una credencial por usuario:

```text
credencial
----------
id PK
usuario_id UNIQUE FK -> usuario.id
contrasenia_hash
algoritmo
intentos_fallidos
bloqueado_hasta NULL
ultimo_acceso_at NULL
fecha_creacion
fecha_actualizacion
```

Nunca se almacena la contraseña original.

## Entidades específicas del chofer

### `usuario_chofer`

Solo existe para un `usuario` cuyo rol sea `CHOFER`:

```text
usuario_chofer
--------------
id PK
usuario_id UNIQUE FK -> usuario.id
disponibilidad
carnet_conducir_validado
fecha_creacion
fecha_actualizacion
```

Las relaciones externas siguen apuntando a `usuario.id`. La existencia de `usuario_chofer` se verifica cuando una operación necesita datos propios del chofer.

### `vehiculo`

```text
vehiculo
--------
id PK
patente UNIQUE
tipo_vehiculo
marca
modelo
anio_fabricacion
color
capacidad_pasajeros
estado
created_at
updated_at
```

### `chofer_vehiculo`

La relación entre choferes y vehículos permite que un vehículo sea asignado a uno o más choferes:

```text
chofer_vehiculo
---------------
id PK
usuario_chofer_id FK -> usuario_chofer.id
vehiculo_id FK -> vehiculo.id
estado_asignacion
asignado_at
desasignado_at NULL
```

Reglas:

- Un chofer no puede tener dos vehículos con asignación activa al mismo tiempo.
- Un vehículo puede tener varios choferes asignados.
- Una asignación finalizada conserva `desasignado_at`.
- Un chofer solo puede aceptar viajes si está habilitado, disponible y tiene un vehículo activo.

## Ubicaciones

### `ubicacion_actual`

Es la última posición conocida de un pasajero o chofer. Se actualiza, no se acumula:

```text
ubicacion_actual
----------------
id PK
usuario_id UNIQUE FK -> usuario.id
latitud
longitud
actualizado_at
precision_metros NULL
```

Solo pueden tener registros los usuarios con rol `PASAJERO` o `CHOFER`.

### `ubicacion_historica`

Cada fila representa una posición histórica. Un usuario puede tener muchas filas:

```text
ubicacion_historica
-------------------
id PK
usuario_id FK -> usuario.id
viaje_id FK -> viaje.id NULL
latitud
longitud
registrado_at
precision_metros NULL
```

No debe existir `UNIQUE(usuario_id)`. Las ubicaciones históricas asociadas a viajes se guardan como máximo cada 15 segundos y se conservan durante 60 días, según el ADR 0010. `viaje_id` puede ser `NULL` cuando el punto no pertenece a un viaje.

## Viajes y asignación

### `viaje`

El viaje se crea cuando el pasajero confirma una estimación, antes de tener chofer asignado:

```text
viaje
-----
id PK
codigo UNIQUE
pasajero_usuario_id FK -> usuario.id
chofer_usuario_id FK -> usuario.id NULL
vehiculo_utilizado_id FK -> vehiculo.id NULL
vehiculo_utilizado JSONB NULL
estado
origen_latitud
origen_longitud
destino_latitud
destino_longitud
precio_estimado
precio_final NULL
multiplicador_demanda
datos_demanda JSONB
solicitado_at
asignado_at NULL
iniciado_at NULL
finalizado_at NULL
cancelado_at NULL
motivo_cancelacion NULL
fecha_creacion
fecha_actualizacion
```

`vehiculo_utilizado_id` identifica el vehículo asignado. `vehiculo_utilizado` guarda una copia inmutable de los datos relevantes del vehículo en el momento de la asignación. Ambos campos son `NULL` antes de que un chofer acepte.

`datos_demanda` es una fotografía de los factores utilizados para calcular el precio, por ejemplo:

```json
{
  "zona": "centro",
  "choferes_disponibles": 8,
  "solicitudes_activas": 24,
  "llueve": true,
  "franja_horaria": "TARDE",
  "factor_lluvia": 1.1,
  "factor_disponibilidad": 1.2,
  "factor_demanda": 1.5,
  "factor_horario": 1.0,
  "multiplicador_aplicado": 1.98
}
```

El precio y el multiplicador quedan congelados al confirmar. No se utilizan versiones de configuración por ahora.

### `oferta`

Una oferta es una propuesta de un viaje enviada a un chofer específico. El pasajero no recibe una oferta: es el pasajero quien crea y confirma el viaje.

```text
oferta
------
id PK
viaje_id FK -> viaje.id
chofer_usuario_id FK -> usuario.id
estado
enviada_at
expira_at
respondida_at NULL
motivo_respuesta NULL
fecha_creacion
fecha_actualizacion
```

Estados iniciales:

```text
PENDIENTE
ACEPTADA
RECHAZADA
VENCIDA
CANCELADA
NO_SELECCIONADA
```

El pasajero se obtiene mediante `oferta.viaje_id -> viaje.pasajero_usuario_id`; no se duplica `pasajero_usuario_id` en `oferta`.

Restricción recomendada:

```text
UNIQUE(viaje_id, chofer_usuario_id)
```

## Precio dinámico

### `configuracion_tarifa`

```text
configuracion_tarifa
--------------------
id PK
tarifa_base
precio_por_kilometro
precio_por_minuto
sensibilidad_demanda
sensibilidad_disponibilidad
multiplicador_minimo
multiplicador_maximo
activo
fecha_creacion
fecha_actualizacion
```

### `zona`

```text
zona
----
id PK
nombre
descripcion NULL
geometria NULL
activa
fecha_creacion
fecha_actualizacion
```

La zona permite calcular demanda y disponibilidad. La implementación geográfica concreta queda sujeta al ADR de geolocalización.

### Factores de la estimación

La fórmula propuesta es:

```text
factor_total = limitar(
  factor_lluvia * factor_disponibilidad * factor_demanda * factor_horario,
  multiplicador_minimo,
  multiplicador_maximo
)

precio_estimado = redondear(
  tarifa_base
  + distancia_km * precio_por_kilometro
  + duracion_minutos * precio_por_minuto
) * factor_total
```

La estimación tiene una vigencia de tres minutos. Al confirmar, el servidor verifica que no haya vencido y persiste el precio, el multiplicador y `datos_demanda`.

## Estados del viaje

```text
SOLICITADO
  ├─> ASIGNADO
  ├─> SIN_CHOFERES_DISPONIBLES
  ├─> CANCELADO_POR_PASAJERO
  └─> CANCELADO_POR_OPERADOR

ASIGNADO
  ├─> CHOFER_EN_CAMINO
  ├─> CANCELADO_POR_PASAJERO
  ├─> CANCELADO_POR_CHOFER
  └─> CANCELADO_POR_OPERADOR

CHOFER_EN_CAMINO
  ├─> EN_CURSO
  ├─> CANCELADO_POR_PASAJERO
  ├─> CANCELADO_POR_CHOFER
  └─> CANCELADO_POR_OPERADOR

EN_CURSO
  ├─> FINALIZADO
  └─> CANCELADO_POR_OPERADOR
```

Un viaje finalizado o cancelado es terminal y no puede volver a recibir ofertas.

## Flujo mínimo del viaje

```text
1. El pasajero solicita una estimación.
2. El servidor calcula tarifa base y factores dinámicos.
3. El pasajero confirma mientras la estimación está vigente.
4. Se crea el viaje en estado SOLICITADO.
5. El sistema busca choferes habilitados, disponibles y cercanos.
6. Se crean ofertas con vencimiento.
7. Un chofer acepta una oferta.
8. El viaje pasa a ASIGNADO y se congela el chofer y el vehículo.
9. El chofer marca CHOFER_EN_CAMINO.
10. El chofer inicia y el viaje pasa a EN_CURSO.
11. El chofer finaliza y se calcula el precio final.
```

## Invariantes

1. Un viaje tiene un único pasajero.
2. Un viaje tiene como máximo un chofer asignado; antes de la asignación, `chofer_usuario_id` es `NULL`.
3. Un chofer no puede tener dos viajes activos.
4. Un viaje cancelado o finalizado no puede recibir una aceptación posterior.
5. Una oferta vencida no puede aceptarse.
6. Un usuario pasajero solo puede solicitar y consultar sus propios viajes.
7. Un chofer solo puede aceptar ofertas dirigidas a él.
8. El pasajero solo puede consultar la ubicación del chofer asignado a su viaje.
9. El chofer solo puede consultar las posiciones relacionadas con sus viajes autorizados.
10. La tarifa se calcula en el servidor.
11. El precio y el multiplicador confirmados no cambian si cambia la demanda durante el viaje.
12. La misma intención con la misma `Clave-Idempotencia` produce un único efecto.
13. Un cobro finalizado no se ejecuta dos veces por reintentos.

## Concurrencia que debe resolverse

- Al menos cincuenta choferes aceptan el mismo viaje: exactamente una aceptación tiene éxito.
- El pasajero cancela mientras un chofer acepta: el resultado debe ser uno de los estados definidos, sin chofer ocupado sin viaje ni viaje asignado a un pasajero cancelado.
- Un chofer con viaje activo intenta aceptar otro: la operación se rechaza.
- La demanda o los factores cambian mientras el pasajero confirma: se confirma únicamente la estimación vigente que el pasajero aceptó.
- Varias ubicaciones llegan simultáneamente: una observación antigua no debe sobrescribir una más nueva.

## Entidades fuera del primer MVP

Estas entidades son necesarias para completar todo el alcance, pero pueden incorporarse después del flujo inicial de solicitud y asignación:

- `cobro`, para registrar el cobro simulado e idempotente;
- canal WebSocket o SSE para tiempo real;
- auditoría detallada de transiciones;
- política completa de clima y adaptador externo;
- PostGIS o índice geográfico definitivo;
- notificaciones y preferencias del pasajero.

## Decisiones relacionadas

- ADR 0004: resolución de la carrera de asignación.
- ADR 0005: tarea pesada de ubicaciones y búsqueda.
- ADR 0006: congelamiento del precio dinámico.
- ADR 0008: fuente del dato de lluvia.
- ADR 0010: retención de ubicaciones históricas.
- ADR 0011: ubicaciones genéricas por usuario.
- ADR 0012: separación de persona, usuario y perfiles por rol.
- ADR 0013: estrategia de búsqueda geográfica.
