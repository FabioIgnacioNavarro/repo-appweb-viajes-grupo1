# ADR 0019: Consultar el estado de viaje activo antes de ofrecer un chofer

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Grupo 1 — pendiente de completar

## Contexto

Un chofer con un viaje activo no puede aparecer como disponible ni recibir una nueva asignación. `ms-flota` no debe modificar estados de viajes; esa responsabilidad pertenece a `ms-viajes`.

## Opciones consideradas

### Guardar `ocupado` dentro de `ms-flota`

Ventajas: lectura rápida y autonomía del servicio.

Desventajas: duplica el estado de `ms-viajes`, puede quedar desactualizado y permite contradicciones ante fallas de red.

### Consultar un puerto de viajes activos

Ventajas: la fuente de verdad sigue siendo el ciclo de vida del viaje; `ms-flota` solo filtra candidatos y no altera viajes.

Desventajas: agrega una dependencia de lectura entre servicios y debe definir qué ocurre si la consulta no responde.

### Usar una bandera temporal en memoria o Redis

Ventajas: baja latencia para el camino de búsqueda.

Desventajas: no reemplaza PostgreSQL, puede perderse o divergir y agrega infraestructura innecesaria en esta etapa.

## Decisión

Se elige el puerto `RepositorioViajesActivos`. El adaptador real consultará el contrato de `ms-viajes` o una proyección persistente acordada; el adaptador en memoria se usa en tests. Si la dependencia no responde, el servicio debe fallar cerrado y no devolver al chofer como candidato.

## Consecuencias

La responsabilidad de ocupación permanece en `ms-viajes`. La búsqueda debe tratar un error de esa dependencia como no disponibilidad, registrar el hecho y no permitir asignaciones inseguras. Redis no se agrega por esta decisión.

## Qué nos haría cambiar de decisión

Latencia o indisponibilidad demostrada que impida cumplir el objetivo de asignación, junto con una proyección consistente y auditable que pueda convertirse en la nueva fuente de lectura.
