# ADR 0030: Integrar los servicios por puertos HTTP con propagación del JWT

- Estado: aceptado
- Fecha: 2026-10-16
- Participantes: Grupo 1 — Echeverria, Borchichi y Navarro

## Contexto

El vertical se divide entre `ms-viajes`, `ms-tarifas` y `ms-flota`. Las consultas de estimación,
demanda, candidatos y ocupación necesitan cruzar esos límites sin mover reglas de negocio a clientes
HTTP ni alterar silenciosamente las rutas públicas.

## Opciones consideradas

### Llamadas directas desde controladores a cada API

Ventajas: menos capas para el primer prototipo.

Desventajas: mezcla transporte y orquestación, duplica timeout y manejo de errores, y dificulta
probar idempotencia y fallas sin levantar todos los procesos.

### Adaptadores HTTP detrás de puertos y orquestación fuera de Express

Ventajas: contratos testeables con dobles, transporte uniforme, JWT propagado explícitamente y
errores controlados; la asignación y el precio siguen siendo responsabilidad de sus dominios.

Desventajas: agrega DTOs de integración y requiere mantener pruebas de compatibilidad entre servicios.

## Decisión

Se eligen adaptadores HTTP detrás de puertos. `ms-viajes` recupera una estimación con el JWT del
pasajero y consulta candidatos de `ms-flota` después de confirmar. El caso de uso de aplicación crea
ofertas para hasta veinte candidatos únicos; los reintentos con la misma clave reutilizan el viaje y
no duplican ofertas. `ms-tarifas` consulta disponibilidad de flota y demanda por zona. `ms-flota`
consulta a `ms-viajes` los identificadores ocupados en una sola lectura. Las llamadas son GET,
reenvían el bearer original, aplican 1500 ms por intento y un reintento tras 100 ms solo ante timeout,
429, 502, 503 o 504, de acuerdo con ADR 0023. Las dependencias caídas producen `503` y nunca una
lista vacía interpretada como respuesta válida. Los clientes registran solo servicio, operación y
resultado; nunca URL, JWT, coordenadas ni cuerpo.

El gateway solo enruta las rutas públicas ya documentadas. Los recursos bajo `/interno/` no se
exponen en Nginx. Los contratos internos usan los mismos JWT externos para propagar identidad; los
endpoints agregados devuelven únicamente conteos o IDs de choferes solicitados por flota.

PostgreSQL permanece como fuente de verdad según ADR 0026. Este ADR no convierte repositorios en
memoria de `ms-viajes` en persistencia real; esa integración debe considerarse pendiente hasta que
el adaptador de viajes persista sus operaciones.

## Consecuencias

Una confirmación queda registrada antes de consultar candidatos en la composición actual; si flota
falla, se responde `503`, y el mismo `Clave-Idempotencia` permite reanudar el matching sin duplicar
viajes. La exclusión de choferes ocupados consulta `ms-viajes`; la aceptación atómica entre réplicas
requiere el adaptador persistente de viajes y sus restricciones de base de datos.

## Qué nos haría cambiar de decisión

Una medición reproducible que requiera mensajería asíncrona o cambios de protocolo, acompañada por
una garantía explícita de idempotencia, propagación de identidad y reconciliación de asignaciones.
