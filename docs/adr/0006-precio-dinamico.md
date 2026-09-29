# ADR 0006: Congelar el precio dinámico aceptado por el pasajero

- Estado: propuesto
- Fecha: 2026-09-23
- Participantes: pendiente de completar

## Contexto

La variante A exige que el componente de demanda suba cuando crecen las solicitudes respecto de los choferes disponibles en una zona, y baje cuando la demanda baja. El precio también tendrá ajustes configurables por lluvia y franja horaria, además de la tarifa base por distancia y duración. El pasajero debe conocer el precio antes de confirmar. La estimación tendrá una vigencia de tres minutos y el precio confirmado no cambiará ante variaciones posteriores de los factores. La carrera crítica aparece cuando cambian los factores mientras el pasajero confirma.

## Opciones consideradas

### Congelar precio y factores de la estimación aceptada

Ventajas: el importe aceptado queda claro, es auditable y no cambia durante el viaje. Permite reproducir la decisión con la versión de regla y los datos de disponibilidad, demanda, lluvia y franja horaria.

Desventajas: la estimación puede quedar desactualizada durante su vigencia de tres minutos; vencida, el pasajero debe solicitar otra.

### Recalcular siempre al confirmar

Ventajas: refleja la demanda más reciente y evita confirmar una estimación antigua.

Desventajas: puede cobrar un precio distinto del que el pasajero vio, genera reclamos y hace más difícil garantizar la atomicidad entre aceptación y cálculo.

## Decisión

Se decide aceptar estimaciones durante tres minutos y congelar al confirmar el precio que se mostró al pasajero. El viaje conservará la versión de la regla, la zona y un resumen de disponibilidad, demanda, lluvia y franja horaria usados en el cálculo. Las franjas quedan definidas en `docs/modelo.md`. La fórmula, los límites y los pesos de cada ajuste, y la fuente de lluvia quedan pendientes.

## Consecuencias

Los cambios posteriores de demanda, lluvia o franja horaria no modifican viajes ya confirmados. La operación de confirmación debe comprobar que la estimación no superó los tres minutos, ser atómica respecto del precio y soportar reintentos con idempotencia. La auditoría debe permitir reconstruir el cálculo sin depender del estado actual de la zona ni del clima.

## Qué nos haría cambiar de decisión

Un requisito explícito de la cátedra que permita cambiar el precio después de confirmar, o una imposibilidad demostrada de garantizar que el cliente acepta exactamente el precio persistido.
