# Contratos compartidos

Estas convenciones permiten que módulos y agentes distintos puedan integrarse sin reinterpretar datos.

## Nombres

- Nombres propios de la aplicación —rutas, parámetros, variables y campos JSON— en español. Las rutas usan `kebab-case`, los parámetros `camelCase` y los campos JSON `snake_case`; los métodos y encabezados estándar de HTTP mantienen sus nombres oficiales.
- Estados del dominio en mayúsculas; sus valores JSON usan `snake_case`.
- Identificadores con una forma única definida antes de implementar persistencia. No mezclar UUID, enteros y strings arbitrarios sin ADR.
- No introducir sinónimos públicos para los términos del glosario.

## Fechas, dinero y ubicación

- Fechas y horas: ISO 8601 con zona horaria explícita; persistir en UTC.
- Duraciones: milisegundos en contratos internos y segundos o minutos solo cuando el endpoint lo documente.
- Dinero: moneda del sistema `ARS`, sin centavos; persistir como entero exacto de pesos (por ejemplo, `BIGINT` en PostgreSQL) y exponer en JSON como cadena de dígitos, por ejemplo `"8086"`. No convertir a `number` de JavaScript. Incluir `moneda: "ARS"` en las respuestas con importes.
- Coordenadas: latitud y longitud en grados decimales, con rango validado y sistema de referencia documentado.
- Distancias: unidad explícita, preferentemente metros.

## Respuesta de error

Toda respuesta de error debe seguir esta forma conceptual:

```json
{
  "error": {
    "codigo": "VIAJE_NO_DISPONIBLE",
    "mensaje": "El viaje no está disponible para este usuario.",
    "detalles": {}
  }
}
```

`codigo` es estable y apto para clientes; `mensaje` es legible; `detalles` es opcional y no debe filtrar consultas, trazas internas, secretos ni información de otro usuario.

## Autorización

Autenticar no equivale a autorizar. Cada caso de uso debe verificar actor, rol, propiedad o relación con el recurso y estado permitido. Un identificador conocido nunca alcanza por sí solo.

## Idempotencia

Las operaciones con efectos no repetibles deben aceptar `Clave-Idempotencia`. La clave pertenece a la intención del actor y el resultado guardado debe poder devolverse en un reintento sin repetir el efecto.

## Precio dinámico

- La tarifa base se calcula en el servidor con distancia y duración; disponibilidad, demanda de la zona, lluvia y franja horaria aplican ajustes configurados.
- Si la demanda sube, el componente de demanda eleva el precio; si baja, lo reduce.
- El multiplicador y los ajustes los calcula exclusivamente el servidor.
- Una estimación debe ser identificable, incluir los factores usados y vencer a los tres minutos.
- La confirmación debe conservar el precio visto y los datos de todos los factores usados.
- El precio confirmado es inmutable frente a cambios posteriores de demanda.
- La auditoría debe permitir reconstruir la decisión sin exponer información innecesaria de otros usuarios.

## Cambios de contrato

Un cambio incompatible requiere actualizar `docs/api.md`, agregar o modificar un ADR y registrar pruebas de contrato. Si el cambio afecta otro módulo, debe explicitarse en el pull request.

## Servicios y actor autenticado

La primera separacion de responsabilidades queda definida por el ADR 0016. Los servicios no
implementan login: reciben un JWT en `Authorization: Bearer <token>` y entregan sus claims a los
casos de uso mediante un puerto de validacion. El contrato interno minimo del actor es:

```text
ActorAutenticado {
  id_usuario: string
  rol: PASAJERO | CHOFER | SOPORTE | ADMINISTRADOR
}
```

Mientras no exista una especificacion oficial del emisor, algoritmo y claims, los adaptadores de
prueba pueden construir este actor directamente. Un servicio debe rechazar el pedido si el token
esta vencido, tiene un emisor o audiencia incorrectos, o no permite la operacion solicitada.

Los contratos de servicio se mantienen asi:

- `ms-viajes` consume una estimacion vigente de `ms-tarifas` y candidatos habilitados de `ms-flota`.
- `ms-tarifas` no crea viajes ni asigna choferes.
- `ms-flota` no modifica estados de viajes.
- La confirmacion de viaje conserva `id_estimacion`, `precio_estimado`, `multiplicador_demanda`,
  `factores_precio` y `vigente_hasta` como fotografia auditable.

## Integración inicial de tarifas

`POST /viajes/estimacion` valida JWT y recibe `{ origen: { latitud, longitud }, destino: { latitud,
longitud } }`. `ms-tarifas` resuelve zona, ruta, regla, clima actual, choferes cercanos y solicitudes
activas mediante puertos. La salida incluye importe ARS en string, distancia en metros, duración en
segundos, multiplicador, zona, desglose auditable, versión y vigencia.

Para armar esos factores, `ms-tarifas` reenvía el JWT del pasajero al contrato de cercanía de
`ms-flota` y al contrato interno de demanda de `ms-viajes`. Cada llamada tiene timeout, un reintento
solo para GET transitorios y falla cerrada al superar el presupuesto. Los servicios internos no
publican sus puertos fuera de la red privada de Compose.

## Matching y ocupación entre servicios

Tras confirmar un viaje, `ms-viajes` consume `GET /choferes/cercanos` de `ms-flota` con el mismo JWT
y crea una oferta de 60 segundos para hasta veinte IDs únicos. La creación de ofertas es idempotente
por viaje y chofer, por lo que la misma `Clave-Idempotencia` puede reanudar el matching después de
una caída. La aceptación mantiene la comprobación de exclusión del dominio; la versión actual usa
un asignador en memoria y no ofrece garantía entre procesos hasta integrar la transacción PostgreSQL.

Para excluir ocupados, `ms-flota` usa un adaptador HTTP de request que llama
`GET /interno/choferes/ocupados` en `ms-viajes`, reenviando el bearer. `ms-viajes` solo responde los
IDs solicitados que tienen un viaje en `ASIGNADO`, `CHOFER_EN_CAMINO` o `EN_CURSO`. La estimación de
tarifas consulta `GET /interno/demanda-por-zona`; los viajes `SOLICITADO` se agrupan con el
`factores_precio.zona_id` auditado.

Todos los clientes internos limitan la espera a `TIMEOUT_SERVICIO_MS` (1500 ms predeterminado) y
permiten cero o un reintento (`REINTENTOS_SERVICIO`, máximo 1), tras 100 ms y solo para GET ante
timeout, 429, 502, 503 o 504. Las fallas, JWT rechazados y respuestas no válidas producen un `503`
seguro; flota no devuelve candidatos si no pudo validar ocupación. Los logs registran nombre de
servicio, operación y clase de resultado, sin URL, token, coordenadas ni respuesta remota.

Las rutas `/interno/` y `/estimaciones/:idEstimacion` solo se usan dentro de la red Compose; Nginx
las rechaza. Las rutas públicas ya listadas no cambian. La confirmación y sus repositorios de
`ms-viajes` siguen en memoria en este corte, por lo que el estado y la asignación deben migrarse a
PostgreSQL antes de tratar el flujo como durable o seguro entre réplicas.
