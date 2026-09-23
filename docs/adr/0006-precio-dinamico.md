# ADR 0006: Congelar el multiplicador dinámico al confirmar el viaje

- Estado: propuesto
- Fecha: 2026-09-23
- Participantes: pendiente de completar

## Contexto

La variante A exige que el precio suba o baje según la relación entre solicitudes y choferes disponibles en una zona. El pasajero debe conocer el multiplicador antes de confirmar, y el precio confirmado no puede cambiar aunque la demanda cambie durante el viaje. La carrera crítica aparece cuando la demanda se recalcula mientras el pasajero confirma.

## Opciones consideradas

### Congelar estimación y multiplicador en la confirmación

Ventajas: el importe aceptado queda claro, es auditable y no cambia durante el viaje. Permite reproducir la decisión con la versión de regla y el resumen de demanda.

Desventajas: la estimación puede quedar desactualizada entre la consulta y la confirmación; hay que definir una vigencia o política de revalidación.

### Recalcular siempre al confirmar

Ventajas: refleja la demanda más reciente y evita confirmar una estimación antigua.

Desventajas: puede cobrar un precio distinto del que el pasajero vio, genera reclamos y hace más difícil garantizar la atomicidad entre aceptación y cálculo.

## Decisión

Se propone congelar el multiplicador y el precio en la confirmación. El viaje conservará el multiplicador, la versión de la regla, la zona y un resumen de los datos de demanda usados. La política exacta de vigencia de la estimación queda pendiente de definición.

## Consecuencias

La demanda futura no modifica viajes ya confirmados. La operación de confirmación debe ser atómica respecto del precio y debe soportar reintentos con idempotencia. Será necesario diseñar una forma de auditar el cálculo sin depender del estado actual de la zona.

## Qué nos haría cambiar de decisión

Un requisito explícito de la cátedra que permita cambiar el precio después de confirmar, o una imposibilidad demostrada de garantizar que el cliente acepta exactamente el precio persistido.
