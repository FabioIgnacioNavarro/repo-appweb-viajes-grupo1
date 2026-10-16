# ADR 0028: API HTTP de ms-viajes sobre casos de uso

- Estado: aceptado
- Fecha: 2026-10-16
- Participantes: Grupo 1 — Echeverria, Borchichi y Navarro

## Contexto

`ms-viajes` necesita exponer el ciclo del viaje sin introducir Express, fetch, PostgreSQL o JWT en
el dominio. La API debe traducir autenticacion, validacion de entrada y errores sin duplicar reglas
de estado, autorizacion, idempotencia o concurrencia.

## Opciones consideradas

### Controladores con reglas dentro de Express

Ventajas: menor cantidad inicial de archivos y una implementacion rapida.

Desventajas: mezcla transporte y dominio, dificulta los tests sin HTTP y permite que distintos
endpoints apliquen reglas diferentes.

### Router delgado con casos de uso y puertos inyectados

Ventajas: permite probar HTTP con adaptadores falsos, mantiene las reglas en el dominio y permite
cambiar JWT, tarifas y persistencia sin cambiar las rutas.

Desventajas: requiere definir dependencias y DTOs explicitos; la composicion inicial es mas extensa.

## Decision

Se elige un router Express delgado. El middleware valida el JWT mediante `ValidadorToken`, los
handlers validan forma y limites de entrada, invocan casos de uso y traducen `ErrorDominio` a la
forma comun `{ error: { codigo, mensaje, detalles } }`. Los adaptadores de estimaciones y JWT son
inyectables; los tests usan memoria y `ValidadorTokenFalso`.

## Consecuencias

La API no expone stack traces ni detalles internos. La confirmacion exige `Clave-Idempotencia` y
conserva el snapshot de precio que devuelve `ms-tarifas`. La persistencia y la asignacion atomica
reales quedan para adaptadores posteriores, sin cambiar el contrato HTTP.

## Que nos haria cambiar de decision

Una exigencia de la catedra de usar otra interfaz, o una necesidad demostrada de streaming que
requiera separar el adaptador de seguimiento del router actual.
