# ADR

Cada decisión relevante se registra en un archivo numerado. Todo ADR debe incluir: título, estado, fecha y participantes, contexto, al menos dos opciones con ventajas y desventajas reales, decisión, consecuencias y condición que obligaría a revisarla.

ADRs mínimos previstos:

1. Sistema de módulos: CommonJS en backend (Node 22) y ESM empaquetado con Vite en frontend (React 19).
2. Persistencia y acceso a datos: PostgreSQL y SQL/query builder/ORM.
3. Autenticación y autorización por recurso.
4. Resolución de la doble asignación viaje-chofer.
5. Solución de la tarea pesada de ubicaciones y búsqueda.
6. Canal de tiempo real y reconexión, o la decisión específica más importante del grupo.

Decisiones adicionales registradas:

7. Representación de importes en pesos argentinos sin centavos.
8. Fuente del dato de lluvia para el precio dinámico.
9. Separación de ubicación actual e histórica del chofer.
10. Política de retención de ubicaciones históricas de viajes.
11. Referencias genéricas de ubicación por usuario y roles habilitados.
12. Separación de persona, usuario y perfiles por rol.
13. Estrategia de búsqueda geográfica.
14. Proveedor de rutas para distancia y duración por calles.
15. Demo web de recorrido con Leaflet y OpenStreetMap.
16. Límites de microservicios y autenticación externa.
17. Estrategia inicial de búsqueda de choferes cercanos.
18. Persistencia de ubicación actual y rechazo de observaciones antiguas.
19. Coordinación del estado ocupado del chofer.
20. Configuración del contenedor de `ms-flota`.
21. Regla inicial configurable de precio dinámico.
22. Comportamiento ante fallas de dependencias.
23. Timeouts y reintentos de servicios.
24. Nginx como gateway.
25. Validación de JWT externo.
26. PostgreSQL como fuente de verdad y decisión de no incorporar Redis inicialmente.
27. Composición reproducible de servicios con Docker Compose.
28. Persistencia real de `ms-flota` en PostgreSQL.
29. Proveedor JWT falso restringido a desarrollo y tests.
30. Integración HTTP entre servicios, propagación JWT y recuperación idempotente.
31. API HTTP de `ms-viajes` sobre casos de uso.
32. E2E reproducible con proveedores controlados.
50. Observabilidad distribuida con OpenTelemetry y Jaeger.
51. Geocodificación y cálculo de rutas con Google Maps Platform.
52. Geocodificación abierta con Nominatim (OpenStreetMap) como alternativa sin tarjeta.
53. Geocodificación en cascada por cercanía y geocodificación inversa.
54. Emulador de identidad externa OIDC / JWKS y control de acceso RBAC por recurso.
55. Stack del front-end (React, TypeScript y Tailwind CSS con Vite) y arquitectura modular por roles.

## Rangos reservados para flujos paralelos

Para evitar conflictos de numeración durante el desarrollo en paralelo de los flujos de trabajo:

- **Flujo A (Núcleo de Viajes, Persistencia y Concurrencia):** ADR 0033 a 0039.
  - 33. Asignación concurrente con bloqueo ordenado e índice único parcial.
  - 34. Persistencia de ms-viajes con SQL directo y puertos asíncronos.
- **Flujo B (Flota, Tarea Pesada, Búsqueda Geo y Tiempo Real):** ADR 0040 a 0049.
  - 40. Simulador local y repetible de carga de Flota.
  - 41. Mantener Haversine con prefiltrado geográfico en PostgreSQL, basado en la línea de base de 500 choferes.
  - 42. WebSocket autenticado en `ms-viajes`, eventos por usuario y recuperación mediante GET; ubicaciones aproximadas del chofer desde `ms-flota`.
- **Flujo C (Seguridad, Observabilidad, Google Maps y Operación):** ADR 0050 a 0059.
  - 50. Observabilidad distribuida con OpenTelemetry y Jaeger.
  - 51. Geocodificación y cálculo de rutas con Google Maps Platform.
  - 52. Geocodificación abierta con Nominatim (OpenStreetMap) como alternativa sin tarjeta.
  - 53. Geocodificación en cascada por cercanía y geocodificación inversa.
  - 54. Emulador de identidad externa OIDC / JWKS y control de acceso RBAC por recurso.
55. Stack del front-end (React, TypeScript y Tailwind CSS con Vite) y arquitectura modular por roles.
