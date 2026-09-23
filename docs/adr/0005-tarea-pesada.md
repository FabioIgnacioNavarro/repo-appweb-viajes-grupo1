# ADR 0005: Separar la recepción masiva de ubicaciones de la búsqueda de candidatos

- Estado: propuesto
- Fecha: 2026-09-23
- Participantes: pendiente de completar

## Contexto

La tarea pesada obligatoria combina 500 choferes enviando ubicación cada dos segundos con búsquedas de candidatos. Hay que comparar una versión ingenua y una solución final midiendo latencias, asignación, lag del event loop, throughput y memoria.

## Opciones consideradas

### Índice geográfico en PostgreSQL/PostGIS

Ventajas: búsqueda cerca del origen en la base, persistencia y consultas declarativas.

Desventajas: agrega dependencia y trabajo de índices; debe medirse el costo de escrituras frecuentes.

### Cola o procesamiento separado

Ventajas: desacopla la recepción HTTP y evita ejecutar todo dentro del pedido.

Desventajas: agrega complejidad, consistencia eventual y un servicio auxiliar que debe operar en Docker Compose.

### Estructura geográfica en memoria

Ventajas: lecturas rápidas y menor carga de consulta.

Desventajas: sincronización, recuperación tras reinicio y riesgo de divergencia con la base.

## Decisión

Pendiente de medición comparativa. No se aceptará una elección basada solo en intuición; debe justificarse con el volumen de ubicación y el tiempo de asignación objetivo.

## Consecuencias

La versión ingenua y la versión final deberán coexistir o poder reproducirse para la comparación, sin confundir optimización con pérdida de consistencia.

## Qué nos haría cambiar de decisión

Que la solución elegida no sostenga la carga objetivo, provoque un lag excesivo o deje datos de ubicación que no puedan recuperarse de forma segura.
