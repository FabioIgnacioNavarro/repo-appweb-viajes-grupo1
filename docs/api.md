# API inicial

Este documento es un contrato preliminar. Los nombres y códigos se consolidarán antes de implementar y se podrán convertir en una especificación OpenAPI.

## Convenciones

- JSON para requests y responses.
- Autenticación mediante token, con mecanismo final pendiente del ADR correspondiente.
- Las operaciones que crean o confirman efectos irrepetibles aceptan `Idempotency-Key`.
- Los errores tienen una forma uniforme: `code`, `message` y, cuando corresponda, `details`.
- El servidor valida tipos, campos permitidos, tamaños y valores límite en tiempo de ejecución.

## Salud y ciclo de vida

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/health` | Proceso vivo |
| GET | `/ready` | Proceso listo y base disponible |

## Identidad y perfiles

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/auth/register` | Registrar pasajero o chofer |
| POST | `/auth/login` | Autenticar usuario |
| GET | `/me` | Obtener perfil propio |
| PATCH | `/drivers/me/availability` | Cambiar disponibilidad del chofer |
| POST | `/drivers/me/location` | Registrar ubicación actual |

## Viajes

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/trips/estimate` | Calcular estimación sin crear viaje, incluyendo multiplicador y datos de vigencia |
| POST | `/trips` | Solicitar y confirmar un viaje |
| GET | `/trips/:tripId` | Consultar un viaje autorizado |
| POST | `/trips/:tripId/cancel` | Cancelar según reglas de estado y rol |
| POST | `/trips/:tripId/arrive` | Marcar llegada del chofer |
| POST | `/trips/:tripId/start` | Iniciar viaje |
| POST | `/trips/:tripId/finish` | Finalizar y calcular tarifa/cobro |
| GET | `/trips` | Historial filtrado por usuario autorizado |
| GET | `/trips/:tripId/stream` | Seguimiento en tiempo real; canal a decidir |

## Ofertas

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/driver/offers` | Ver ofertas activas del chofer |
| POST | `/driver/offers/:offerId/accept` | Aceptar una oferta dentro del vencimiento |
| POST | `/driver/offers/:offerId/reject` | Rechazar una oferta |

## Operación y administración

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/operator/trips/active` | Ver viajes en curso como operador |
| POST | `/operator/trips/:tripId/cancel` | Cancelar con motivo |
| PATCH | `/admin/drivers/:driverId/status` | Habilitar o deshabilitar chofer |
| PUT | `/admin/fare-config` | Configurar parámetros de tarifa |

## Precio dinámico

La respuesta de `/trips/estimate` debe incluir, como mínimo, el precio estimado, el multiplicador aplicado, la zona evaluada, la vigencia o versión de la regla y un identificador de la estimación. La confirmación debe referenciar esa estimación o repetir los datos necesarios para impedir que el cliente altere el precio.

El viaje persistirá el multiplicador y el resumen auditable de demanda usado al confirmar. El cliente nunca envía un multiplicador como importe confiable.

## Respuestas y errores mínimos

- `200`: consulta o actualización exitosa.
- `201`: recurso creado.
- `400`: entrada inválida.
- `401`: falta autenticación o token inválido.
- `403`: autenticado sin permiso sobre el recurso.
- `404`: recurso inexistente o no visible según la política elegida.
- `409`: conflicto de estado, concurrencia o idempotencia incompatible.
- `422`: regla de negocio no cumplida.
- `429`: límite de tasa excedido.
- `500`: error inesperado, sin filtrar detalles internos.
