# Glosario del dominio

Este archivo define los términos oficiales. Los agentes deben reutilizar estos nombres en documentación, endpoints, tests, commits y código.

| Término | Definición |
|---|---|
| Usuario | Persona autenticada que puede tener uno o más roles permitidos por el sistema. |
| Pasajero | Usuario que solicita y realiza viajes. |
| Chofer | Usuario con vehículo registrado y habilitación administrativa para tomar viajes. |
| Operador | Rol de soporte que puede observar viajes en curso y ejecutar acciones operativas autorizadas. |
| Administrador | Rol que configura parámetros del sistema y habilita choferes. |
| Viaje | Solicitud persistida que representa el traslado de un pasajero entre un origen y un destino. |
| Viaje activo | Viaje que todavía puede cambiar de estado y ocupa un chofer. Incluye, como mínimo, asignado, chofer en camino y en curso. |
| Oferta | Propuesta de un viaje enviada a un chofer, con vencimiento y resultado. |
| Asignación | Operación atómica que vincula un viaje con un único chofer. |
| Chofer disponible | Chofer habilitado, marcado como disponible y sin viaje activo. |
| Ubicación actual | Última posición válida informada por un usuario con rol Chofer o Pasajero. |
| Ubicación histórica | Registro de posiciones de un Chofer o Pasajero, conservado según la política de retención. |
| Estimación | Precio y duración calculados antes de confirmar el viaje. |
| Tarifa final | Precio calculado por el servidor al finalizar el viaje. |
| Cobro | Registro del intento o resultado de cobrar la tarifa final. |
| Idempotencia | Propiedad por la cual repetir una intención con la misma clave no repite el efecto. |
| Recurso propio | Recurso que pertenece al usuario autenticado o que este puede operar por su rol. |
| Variante | Funcionalidad obligatoria adicional asignada al grupo. Para este grupo es A: precio dinámico por demanda. |

## Estados oficiales iniciales

Los nombres de rutas, parámetros, variables y campos de la aplicación se escriben en español. Los estados se escriben en mayúsculas en el dominio y en `snake_case` en JSON:

`SOLICITADO`, `ASIGNADO`, `CHOFER_EN_CAMINO`, `EN_CURSO`, `FINALIZADO`, `CANCELADO_POR_PASAJERO`, `CANCELADO_POR_CHOFER`, `CANCELADO_POR_OPERADOR`, `SIN_CHOFERES_DISPONIBLES`.

Si aparece un término nuevo que pueda afectar contratos o reglas de negocio, debe agregarse aquí antes de ser usado como concepto público.
