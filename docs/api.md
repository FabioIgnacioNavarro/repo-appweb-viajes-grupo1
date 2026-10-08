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
| GET | `/ready` | Indicar que el proceso está listo y que la base de datos está disponible; responde `503` mientras esa dependencia no esté configurada. |

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

## Demo por terminal

La demo local se ejecuta con `npm run demo`. Solicita el rol del actor, una latitud y longitud de la
ubicación actual y una latitud y longitud de destino, muestra la estimación, confirma el viaje, lo
inicia y lo finaliza. En una terminal las coordenadas actuales se ingresan manualmente porque el
proceso no tiene acceso directo al GPS del dispositivo. No reemplaza los
endpoints HTTP: sirve para demostrar el caso de uso mientras todavía no existe el adaptador web.
Los datos se guardan en memoria durante el proceso y se muestran al finalizar.

La demo usa el proveedor configurado en `RUTA_PROVEEDOR`: `OSRM` para rutas reales por calles,
`GOOGLE` para Google Routes API o `HAVERSINE` para modo offline. La estimación informa el proveedor
utilizado, la distancia real de ruta cuando está disponible y la duración devuelta por el proveedor.

## Estimación de la demo web

El servidor local de `npm run demo:web` expone `POST /demostracion/estimaciones` para que la pantalla
muestre el precio calculado por el mismo caso de uso que utiliza la demo de terminal. Este recurso
es auxiliar y local: no es parte del contrato final de producto y no crea ni confirma un viaje.

Pedido:

```json
{
  "origen": { "latitud": -27.451, "longitud": -58.986 },
  "destino": { "latitud": -27.462, "longitud": -58.993 }
}
```

La respuesta incluye `precio_estimado` como cadena entera de pesos, `moneda: "ARS"`,
`distancia_metros`, `duracion_segundos`, `proveedor_ruta`, `polilinea` cuando el proveedor la
devuelve e `vigente_hasta`. El cálculo usa la tarifa vigente en `src/viaje.ts` y el proveedor
seleccionado mediante `RUTA_PROVEEDOR`. La fórmula actual aplica tarifa base, distancia y duración;
los ajustes dinámicos por demanda, disponibilidad, clima y franja horaria siguen pendientes.

## Primeros endpoints HTTP

El servidor local también publica `GET /health`, `GET /ready` y el endpoint inicial del recorrido,
`POST /viajes/estimacion`. Este último conserva la estimación en memoria durante sus tres minutos de
vigencia y devuelve un `id_estimacion` único. La respuesta añade `multiplicador_demanda: 1`, porque
la fórmula dinámica acordada todavía no está implementada. La zona, los factores y la versión de
regla se incorporarán cuando se cierren DOM-003 y DOM-007; no se inventan valores mientras tanto.

La estimación en memoria se pierde al reiniciar el proceso. `POST /viajes` todavía no está
implementado: requiere vincular la estimación vigente a una identidad autenticada, aplicar
idempotencia y persistir el precio aceptado. `GET /ready` responde `503` mientras la persistencia no
esté configurada.
