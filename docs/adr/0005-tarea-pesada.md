# ADR 0005: Separar la recepción masiva de ubicaciones de la búsqueda de candidatos

- Estado: aceptado
- Relación con otros ADR: complementado por [ADR 0041](./0041-mantener-busqueda-haversine-postgresql.md) (selección de estrategia SQL) y [ADR 0033](./0033-asignacion-concurrente-postgresql.md) (asignación atómica).
- Fecha: 2026-09-23
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino, Navarro Fabio

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

Se adopta la estrategia **optimizada en PostgreSQL** (definida en detalle en [ADR 0041](./0041-mantener-busqueda-haversine-postgresql.md)):

1. **Lectura acotada en SQL**: `RepositorioChoferesPostgres.buscarDisponiblesCercanos` (`src/ms-flota/postgres.ts`) prefiltra choferes `DISPONIBLE` mediante *bounding box* indexado por B-Tree compuesto sobre `(latitud, longitud)` (`idx_ubicacion_actual_estado_lat_lng`), calcula `distancia_metros` con fórmula Haversine dentro de PostgreSQL y limita el resultado a `LIMIT 100`.
2. **Modo de referencia ingenua reproducible para benchmark**: se mantiene la variante `"ingenua"` detrás de `FLOTA_BUSQUEDA_MODO=ingenua` (bloqueada en `NODE_ENV=production`), la cual lee todas las filas de `ubicacion_actual INNER JOIN usuario_chofer` sin prefiltro geográfico en SQL y calcula distancia, filtrado y ordenamiento en el event loop de Node.js.
3. **Medición comparativa ejecutada (`2026-11-26`, Docker Compose, 500 choferes a 250 req/s, 60s medidos + flujo integrado `--incluir-asignacion`)**:
   - **Búsqueda de cercanos**: `optimizada` mejora la cola de latencia (`p95 20,76 ms / p99 26,80 ms` vs. `ingenua` `23,77 ms / 29,34 ms`).
   - **Uso de memoria y event loop en `ms-flota`**: `optimizada` reduce el RSS pico (`171,51 MiB` vs. `189,99 MiB`), el heap pico (`69,69 MiB` vs. `92,90 MiB`) y el lag de event loop (`p99/max 24,20 ms` vs. `26,71 ms`).
   - **Asignación de viaje bajo carga (`solicitud_hasta_asignacion`)**: `POST /viajes` (`p50 23,74 ms`, `p95 43,28 ms`, `12/12 OK`) y confirmación + oferta + aceptación atómica end-to-end (`p50 49,84 ms`, `p95 134,62 ms`, `12/12 OK`) cumplen ampliamente los SLA objetivo (`<= 1.000 ms p50 / <= 3.000 ms p95` confirmación y `<= 5.000 ms p95 / <= 8.000 ms p99` asignación).

## Consecuencias

La versión ingenua y la versión final optimizada coexisten para auditoría y benchmarks comparativos mediante `FLOTA_BUSQUEDA_MODO`, mientras que en producción solo se permite la variante optimizada en PostgreSQL sin comprometer la consistencia transaccional de la asignación.

## Qué nos haría cambiar de decisión

Que la solución elegida no sostenga la carga objetivo, provoque un lag excesivo o deje datos de ubicación que no puedan recuperarse de forma segura.
