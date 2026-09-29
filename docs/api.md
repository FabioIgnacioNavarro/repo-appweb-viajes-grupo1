# API inicial

Este documento define un contrato preliminar. Las rutas, los parámetros y los nombres propios de los datos de la aplicación se escriben en español. Los métodos, códigos de estado y encabezados estándar de HTTP conservan sus nombres oficiales. El contrato se consolidará antes de implementar y podrá convertirse en una especificación OpenAPI.

## Convenciones

- JSON para pedidos y respuestas.
- Los nombres de rutas y parámetros están en español, sin tildes ni espacios; se usa `kebab-case` en rutas y `camelCase` en parámetros de ruta.
- Los campos JSON están en español y usan `snake_case`.
- La moneda del sistema es el peso argentino (`ARS`), sin centavos. Los importes se representan como cadenas con dígitos enteros en JSON, por ejemplo `"8086"`; el dominio y PostgreSQL los manejan como enteros exactos. Las respuestas incluyen `moneda: "ARS"` junto a los importes. No convertir importes a `number` de JavaScript.
- Autenticación mediante `Authorization: Bearer <token>`; el mecanismo final queda pendiente del ADR correspondiente.
- Las operaciones que crean o confirman efectos irrepetibles aceptan el encabezado `Clave-Idempotencia`.
- Los errores tienen una forma uniforme: `codigo`, `mensaje` y, cuando corresponda, `detalles`.
- El servidor valida tipos, campos permitidos, tamaños y valores límite en tiempo de ejecución.

## Salud y ciclo de vida

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/health` | Indicar que el proceso está vivo. |
| GET | `/ready` | Indicar que el proceso está listo y que la base de datos está disponible. |

## Identidad y perfiles

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/autenticacion/registro` | Registrar un pasajero o chofer. |
| POST | `/autenticacion/inicio-sesion` | Autenticar a un usuario. |
| GET | `/perfil` | Obtener el perfil propio. |
| PATCH | `/choferes/yo/disponibilidad` | Cambiar la disponibilidad del chofer autenticado. |
| POST | `/choferes/yo/ubicacion` | Registrar la ubicación actual del chofer autenticado. |

## Viajes

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/viajes/estimacion` | Calcular una estimación sin crear un viaje, incluyendo multiplicador y vigencia. |
| POST | `/viajes` | Solicitar y confirmar un viaje. |
| GET | `/viajes/:idViaje` | Consultar un viaje autorizado. |
| POST | `/viajes/:idViaje/cancelacion` | Cancelar según las reglas de estado y rol. |
| POST | `/viajes/:idViaje/llegada` | Marcar la llegada del chofer. |
| POST | `/viajes/:idViaje/inicio` | Iniciar el viaje. |
| POST | `/viajes/:idViaje/finalizacion` | Finalizar el viaje y calcular la tarifa y el cobro. |
| GET | `/viajes` | Consultar el historial permitido para el usuario autenticado. |
| GET | `/viajes/:idViaje/seguimiento` | Consultar el seguimiento en tiempo real; el canal queda pendiente de decisión. |

## Ofertas

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/choferes/yo/ofertas` | Ver las ofertas activas del chofer autenticado. |
| POST | `/choferes/yo/ofertas/:idOferta/aceptacion` | Aceptar una oferta antes de su vencimiento. |
| POST | `/choferes/yo/ofertas/:idOferta/rechazo` | Rechazar una oferta. |

## Operación y administración

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/operaciones/viajes-activos` | Ver los viajes en curso como operador. |
| POST | `/operaciones/viajes/:idViaje/cancelacion` | Cancelar un viaje como operador, indicando el motivo. |
| PATCH | `/administracion/choferes/:idChofer/estado` | Habilitar o deshabilitar un chofer. |
| PUT | `/administracion/configuracion-tarifa` | Configurar los parámetros de tarifa. |

## Precio dinámico

La tarifa base se calcula en el servidor a partir de la distancia y duración estimadas. Sobre esa base se aplican, en el orden de definición acordado, los ajustes configurados por lluvia, choferes disponibles, demanda de solicitudes en la zona y franja horaria. Las franjas usan la hora local de la zona. La respuesta de `/viajes/estimacion` debe incluir, como mínimo, `precio_estimado`, `moneda`, `multiplicador_demanda`, `zona`, `factores_precio`, `vigente_hasta`, `version_regla` e `id_estimacion`. La estimación puede confirmarse durante los tres minutos posteriores a su creación. La confirmación debe referenciar esa estimación y usar exactamente el precio que el pasajero vio, aunque cambien los factores mientras tanto.

El viaje persistirá el precio confirmado y el resumen auditable de todos los factores usados al estimar. El cliente nunca envía un multiplicador como importe confiable.

Ejemplo preliminar de pedido de estimación:

```json
{
  "origen": { "latitud": -27.451, "longitud": -58.986 },
  "destino": { "latitud": -27.462, "longitud": -58.993 }
}
```

Ejemplo preliminar de respuesta y confirmación:

```json
{
  "id_estimacion": "estimacion-de-prueba",
  "precio_estimado": "8086",
  "moneda": "ARS",
  "multiplicador_demanda": 1.0,
  "zona": "centro",
  "factores_precio": {
    "choferes_disponibles": 12,
    "solicitudes_activas": 10,
    "llueve": false,
    "franja_horaria": "mañana",
    "lluvia_mm": 0.0,
    "fuente_clima": "proveedor-pendiente"
  },
  "version_regla": 1,
  "creada_en": "2026-09-29T12:04:05Z",
  "vigente_hasta": "2026-09-29T12:07:05Z"
}
```

La confirmación envía `id_estimacion` en el cuerpo de `POST /viajes` y la clave de reintento en `Clave-Idempotencia`. Si la estimación tiene más de tres minutos, el servidor rechaza la confirmación con `409` y el código `ESTIMACION_VENCIDA`; el pasajero solicita otra estimación. El ejemplo de importe es orientativo, no una tarifa definida para el sistema. La distancia se expresa en metros y la duración en segundos en los contratos que informen esas magnitudes. Los horarios de las franjas ya están definidos en `docs/modelo.md`; la fórmula, los límites de cada factor y la fuente de lluvia siguen propuestos o pendientes.

## Respuestas y errores mínimos

- `200`: consulta o actualización exitosa.
- `201`: recurso creado.
- `400`: entrada inválida.
- `401`: falta autenticación o el token no es válido.
- `403`: usuario autenticado sin permiso sobre el recurso.
- `404`: recurso inexistente o no visible según la política elegida.
- `409`: conflicto de estado, concurrencia o idempotencia.
- `422`: regla de negocio no cumplida.
- `429`: límite de solicitudes excedido.
- `500`: error inesperado, sin filtrar detalles internos.

Ejemplo de error:

```json
{
  "error": {
    "codigo": "VIAJE_NO_DISPONIBLE",
    "mensaje": "El viaje no está disponible para este usuario.",
    "detalles": {}
  }
}
```
