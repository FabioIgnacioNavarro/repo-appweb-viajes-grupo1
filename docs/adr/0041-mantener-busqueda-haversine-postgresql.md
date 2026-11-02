# ADR 0041: Mantener Haversine con prefiltrado geográfico en PostgreSQL

- **Estado:** Aceptado para la carga objetivo actual de 500 choferes.
- **Fecha:** 2026-11-02.
- **Participantes:** Grupo 1 — Flujo B.

## Contexto

`ms-flota` recibe ubicaciones frecuentes y busca choferes disponibles alrededor del origen. El ADR 0017 eligió PostgreSQL estándar: filtrar por estado, antigüedad y cuadro geográfico, calcular Haversine sobre ese subconjunto y ordenar los candidatos. ARC-004 pide revisar esa elección con la carga de 500 choferes cada dos segundos.

La línea de base se ejecutó tres veces con 500 choferes, 250 actualizaciones/s, una búsqueda y dos sondas por segundo, cinco minutos medidos y la semilla 42. El código de búsqueda coincide con `203451f`; se ejecutó desde el commit `b603a8f`, que agregó instrumentación sin cambiar `src/ms-flota`.

## Alternativas consideradas

### A. PostgreSQL estándar: bounding box más Haversine

- Mantiene PostgreSQL como fuente de verdad y no agrega extensiones ni imágenes nuevas a Compose.
- El filtro por latitud y longitud tiene índices B-tree disponibles y reduce el conjunto sobre el que se calcula la distancia exacta. No se tomó un plan `EXPLAIN (ANALYZE, BUFFERS)` en esta serie, así que no se afirma qué índice eligió el planificador.
- En las tres mediciones, la mediana de búsqueda fue p95 **28,02 ms** y p99 **209,35 ms**, frente a los objetivos de 300 y 600 ms. Las 900 búsquedas respondieron HTTP 200.
- El límite es que el bounding box es aproximado y la consulta debe seguir aplicando la distancia exacta. La prueba cubre 500 choferes, no una flota de escala mayor.

### B. PostGIS con índice GiST

- Expresa consultas espaciales y distancias mediante tipos y operadores especializados; GiST puede reducir el trabajo de búsqueda cuando crece la cantidad de ubicaciones.
- Agrega una imagen PostgreSQL con PostGIS, extensión, tipos espaciales y mantenimiento de un índice espacial actualizado con cada ubicación. Esa escritura compite con las 250 actualizaciones/s.
- No se midió una implementación PostGIS en esta serie. Con la latencia actual por debajo del umbral, no hay evidencia de que su complejidad reduzca un cuello de botella observado.

### C. Geohash

- Permite filtrar por celdas indexables sin instalar PostGIS.
- Requiere calcular y mantener claves en cada actualización, consultar celdas vecinas y resolver bordes y precisión. No hay una implementación comparativa en el repositorio ni evidencia de que mejore la carga medida.

## Decisión

Mantener la alternativa A para el objetivo actual de 500 choferes. Su latencia de búsqueda cumple los umbrales en las tres repeticiones y evita introducir infraestructura espacial sin una necesidad medida. No se agregará PostGIS ni geohash en esta decisión.

La selección del algoritmo queda resuelta para la escala académica actual; esto **no cierra MED-001**. La serie de carga registró un incumplimiento del crecimiento RSS (12,77 % en la repetición 3, por encima del 10 %) y una repetición ofreció una actualización menos que las 75.000 previstas. El escenario de reposo se midió posteriormente en tres repeticiones y se registra en `docs/mediciones.md`; todavía falta medir una variante final/optimizada.

## Consecuencias

- PostgreSQL continúa como fuente de verdad; la posición actual permanece separada del historial.
- Se conserva una única fila de posición actual por chofer, el filtro de frescura de 30 segundos y el rechazo atómico de actualizaciones antiguas, documentado en el ADR 0018.
- La serie de línea de base se documenta en `docs/mediciones.md`; los informes JSON completos permanecen locales y excluidos de Git.
- No se afirma que Haversine sea la mejor opción para escalas mayores ni que la comparación PostGIS haya sido medida.

## Qué nos haría cambiar de decisión

Evaluar PostGIS o geohash si tres repeticiones de una carga mayor incumplen los umbrales de latencia de búsqueda, si aumenta sustancialmente la cantidad de choferes, o si `EXPLAIN (ANALYZE, BUFFERS)` demuestra que el prefiltrado actual no usa los índices como se espera. Cualquier alternativa debe volver a medirse con igual volumen de escrituras, semilla, pool y equipo.
