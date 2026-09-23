# ADR 0002: Mantener PostgreSQL como base relacional candidata

- Estado: propuesto
- Fecha: 2026-09-23
- Participantes: pendiente de completar

## Contexto

El enunciado exige persistencia relacional y evalúa transacciones, restricciones, bloqueos y concurrencia. El sistema necesita representar viajes, ofertas, choferes, ubicaciones, estados e idempotencia.

## Opciones consideradas

### PostgreSQL

Ventajas: cumple directamente el requisito relacional, ofrece transacciones y bloqueos de filas, restricciones, índices y PostGIS si se elige esa alternativa geográfica.

Desventajas: requiere diseñar migraciones y entender correctamente transacciones, índices y consultas geográficas.

### MongoDB

Ventajas: modelo flexible y desarrollo inicial rápido para documentos.

Desventajas: no satisface el requisito relacional obligatorio de la consigna y haría más difícil demostrar el modelo de concurrencia relacional esperado.

## Decisión

Usar PostgreSQL como opción de trabajo. El acceso a datos y el posible uso de PostGIS se decidirán en ADRs específicos.

## Consecuencias

La consistencia de asignaciones e idempotencia podrá apoyarse en transacciones, restricciones y bloqueos. El esquema y sus migraciones pasan a ser parte esencial de la reproducibilidad.

## Qué nos haría cambiar de decisión

Solo una modificación explícita del enunciado o una restricción técnica de la cátedra que vuelva inviable PostgreSQL.
