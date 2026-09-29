# Plan de mediciones

Todavía no hay resultados: este archivo define cómo se medirán y qué evidencia debe quedar registrada.

## Hipótesis inicial

Con al menos 500 choferes enviando ubicación cada dos segundos, la estrategia elegida para ubicación y búsqueda mantendrá el p95 de solicitud de viaje y el tiempo hasta asignación dentro de límites que el grupo declarará antes de medir, sin degradar de forma inaceptable `/estado/health`.

Antes de ejecutar la primera medición se deben completar los valores numéricos, no modificar la hipótesis para hacerla coincidir con el resultado.

## Escenarios

1. Línea de base sin carga de ubicaciones.
2. Versión ingenua: recepción y búsqueda sin la optimización elegida.
3. Versión final: solución elegida y justificada.
4. Carga sostenida con 500 choferes durante varios minutos.
5. Al menos tres repeticiones por escenario.

## Métricas obligatorias

| Métrica | Unidad | Escenario ingenuo | Escenario final |
|---|---:|---:|---:|
| Latencia p50 de solicitud | ms | Pendiente | Pendiente |
| Latencia p95 de solicitud | ms | Pendiente | Pendiente |
| Latencia p99 de solicitud | ms | Pendiente | Pendiente |
| Tiempo hasta asignación | ms | Pendiente | Pendiente |
| Pedidos por segundo | req/s | Pendiente | Pendiente |
| Lag máximo del event loop | ms | Pendiente | Pendiente |
| Lag p99 del event loop | ms | Pendiente | Pendiente |
| Memoria | MB | Pendiente | Pendiente |

## Entorno y reproducibilidad

Completar con sistema operativo, CPU, RAM, Node.js, PostgreSQL, Docker, servicios activos, volumen de datos y comandos exactos. La medición debe usar `monitorEventLoopDelay` dentro del servidor y un simulador versionado propio.

## Conclusión

Se completará después de medir, indicando si la hipótesis se cumplió, qué trade-offs aparecieron y qué decisión se tomó a partir de los números.
