# ADR 0016: Microservicios con autenticacion externa

- Estado: propuesto
- Fecha: 2026-10-15
- Participantes: Grupo 1 — Echeverria, Borchichi y Navarro

## Contexto

El equipo necesita separar el trabajo en `ms-viajes`, `ms-tarifas` y `ms-flota`, ejecutar cada servicio en contenedores y validar un JWT emitido fuera de los servicios. El enunciado exige Express, PostgreSQL, Docker Compose y arquitectura hexagonal, pero no exige microservicios ni un proveedor concreto de autenticacion. La decision debe permitir avanzar con el dominio sin depender de un login disponible durante los tests.

## Opciones consideradas

### Monolito modular

Ventajas: una sola composicion, despliegue y transaccion; menor costo de integracion y una demostracion mas simple.

Desventajas: menor aislamiento entre equipos y mas riesgo de acoplamiento si no se respetan puertos y limites.

### Tres microservicios

Ventajas: separa responsabilidades, permite asignar un servicio a cada integrante y obliga a explicitar contratos.

Desventajas: agrega fallas de red, configuracion, observabilidad y consistencia entre servicios; no reemplaza las pruebas de dominio.

## Decision

Se propone trabajar con tres servicios logicos y desplegables (`ms-viajes`, `ms-tarifas` y `ms-flota`), cada uno con dominio, puertos y adaptadores propios. La integracion se hara mediante contratos HTTP documentados. PostgreSQL sera la fuente de verdad persistente; la separacion en una o dos bases queda sujeta al ADR de persistencia y no se implementa en esta etapa.

La autenticacion sera externa. Cada servicio recibira un JWT y validara su firma, emisor, audiencia, vencimiento y claims mediante un puerto `ValidadorToken`. No se implementa login propio ni se guardan credenciales de Firebase. Hasta que la catedra confirme el proveedor y sus claims, los tests usaran un adaptador falso.

Redis no es obligatorio en el primer vertical. Solo se incorporara para idempotencia, expiracion, cache o coordinacion cuando exista un ADR que justifique su uso y defina la fuente de verdad.

## Limites iniciales

- `ms-viajes`: ciclo de vida, ofertas, asignacion, cancelacion, finalizacion, cobro simulado e idempotencia.
- `ms-tarifas`: rutas, distancia, duracion, tarifa dinamica y estimaciones con vigencia.
- `ms-flota`: choferes, habilitacion, disponibilidad, ubicaciones y candidatos cercanos.

## Consecuencias

Los contratos entre servicios deben ser versionables y probarse sin depender de un proveedor externo. Las reglas de negocio permanecen aisladas de Express, PostgreSQL, Redis y Firebase. La asignacion y la confirmacion de precio tendran que resolver consistencia y fallas de red en ADR posteriores.

## Que nos haria cambiar de decision

Una restriccion de la catedra que prohiba microservicios, un costo de integracion que impida demostrar el flujo completo, o una especificacion oficial de autenticacion incompatible con la validacion local.
