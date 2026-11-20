# ADR 0016: Microservicios con autenticacion externa

- Estado: Aceptado
- Fecha: 2026-10-15 (actualizado 2026-11-19 en ARC-006)
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

Se trabaja con tres servicios logicos y desplegables (`ms-viajes`, `ms-tarifas` y `ms-flota`), cada uno con dominio hexagonal, puertos y adaptadores propios. La integracion se hace mediante contratos HTTP documentados con propagacion de `Authorization: Bearer` y trazabilidad W3C (`traceparent`). PostgreSQL es la fuente de verdad persistente con frontera estricta por servicio (esquemas/tablas aisladas; prohibido consultar tablas de otro microservicio o definir claves foraneas cruzadas).

La autenticacion es externa. Cada servicio valida el JWT de entrada mediante el puerto `ValidadorToken` (`ValidadorJwtJwks` en modo real RS256 contra JWKS: algoritmo `RS256`, firma, `iss`, `aud`, `exp`, `nbf`, `sub` y claim configurable de rol), entregando al dominio un `ActorJWT` (`{ idUsuario, rol }`). No se implementa login propio ni se guardan credenciales de terceros. El adaptador offline (`JWT_MODO=falso`) queda restringido exclusivamente a desarrollo/pruebas locales y esta estrictamente bloqueado al arranque y en ejecucion cuando `NODE_ENV=production`.

Redis no es obligatorio en el primer vertical. Solo se incorporara cuando exista un ADR con medicion de carga que justifique su uso.

## Limites de servicio y fronteras de datos

- `ms-viajes` (esquema PostgreSQL `viajes` en `src/ms-viajes/schema.sql`): ciclo de vida del viaje (`viaje`), ofertas con vigencia (`oferta`), claves de idempotencia (`idempotencia`) y cobros (`cobro`).
- `ms-tarifas` (esquema PostgreSQL `tarifa` en `src/ms-tarifas/schema.sql`): zonas tarifarias (`zona_tarifaria`), reglas dinamicas versionadas (`regla_tarifa`) y estimaciones con snapshot de vigencia (`estimacion`).
- `ms-flota` (esquema logico `flota` en `src/ms-flota/schema.sql`): perfil/habilitacion de choferes (`usuario_chofer`), ubicacion actual (`ubicacion_actual`) e historial (`ubicacion_historica`).
- **Regla de aislamiento:** ningun servicio lee ni escribe directamente por SQL en las tablas de otro microservicio; toda coordinacion ocurre a traves de endpoints HTTP documentados (`/estimaciones/:id`, `/viajes/estimacion`, `/choferes/cercanos`, `/interno/demanda-por-zona`, `/interno/choferes/ocupados`, `/interno/viajes/ubicacion-chofer`).

## Consecuencias

Los contratos entre servicios deben ser versionables y probarse sin depender de un proveedor externo. Las reglas de negocio permanecen aisladas de Express, PostgreSQL, Redis y Firebase. La asignacion y la confirmacion de precio tendran que resolver consistencia y fallas de red en ADR posteriores.

## Que nos haria cambiar de decision

Una restriccion de la catedra que prohiba microservicios, un costo de integracion que impida demostrar el flujo completo, o una especificacion oficial de autenticacion incompatible con la validacion local.
