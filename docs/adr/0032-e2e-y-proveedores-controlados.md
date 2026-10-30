# ADR 0032: E2E reproducible con proveedores controlados

- Estado: aceptado
- Fecha: 2026-10-16

## Contexto

La prueba final debe ejecutarse desde un clon limpio sin depender de OSRM público, Open-Meteo ni
credenciales externas.

## Decisión

Compose usa `RUTA_PROVEEDOR=HAVERSINE`, `PROVEEDORES_MODO=falso` y `JWT_MODO=falso` únicamente en
desarrollo/E2E. El clima se resuelve con una fuente determinista sin red; flota y demanda siguen
siendo consultas HTTP entre servicios. PostgreSQL inicializa los esquemas y un chofer de prueba
habilitado, sin secretos. La colección `requests/flujo-e2e.http` y `npm run test:e2e` prueban el
flujo contra el gateway.

## Consecuencias

La E2E demuestra contratos, readiness, autorización, idempotencia, matching y cobro simulado. No
mide la precisión de rutas o clima reales; esas integraciones quedan cubiertas por adaptadores y tests
unitarios. Antes de producción se deben proporcionar JWT JWKS y proveedores reales.
