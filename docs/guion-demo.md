# Guion de demostración — Plataforma de viajes

**Duración estimada:** 12–15 minutos  
**Objetivo:** mostrar los tres roles, la Variante A, el ciclo del viaje, tiempo real, cobro, una caída de dependencia y un intento de acceso bloqueado.

## Preparación antes de la defensa

Desde la raíz del repositorio, en PowerShell:

```powershell
Copy-Item .env.example .env
npm.cmd ci
npm.cmd test
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Esperá a que PostgreSQL, el emulador de identidad, `ms-viajes`, `ms-tarifas`, `ms-flota` y Nginx estén saludables. Confirmá:

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/ready/viajes
Invoke-RestMethod http://localhost:8080/ready/tarifas
Invoke-RestMethod http://localhost:8080/ready/flota
```

Para mostrar la interfaz, abrí otra terminal y ejecutá `npm.cmd run dev:web`; luego abrí `http://localhost:5173`. El servidor web de desarrollo usa el gateway local en `8080`.

El Compose de desarrollo usa `JWT_MODO=falso`. Para que la interfaz represente a los actores con las identidades que están sembradas en la base, en la pantalla de ingreso usá **token manual** y copiá los tokens `@pasajero` y `@chofer` de [`../requests/flujo-e2e.http`](../requests/flujo-e2e.http). Para soporte, generá un token falso local de prueba:

```powershell
$tokenSoporte = node -e "const p={tipo:'jwt-falso',idUsuario:'soporte-demo-1',rol:'SOPORTE'};process.stdout.write('falso.'+Buffer.from(JSON.stringify(p)).toString('base64url'))"
$tokenSoporte
```

Los tokens falsos solo sirven en el entorno local de desarrollo. No son credenciales reales y no deben usarse en producción. Para mantener pasajero y chofer conectados a la vez, usá dos perfiles de navegador separados.

**Nota de alcance:** la interfaz estática aún no se sirve desde Nginx. Además, el cliente web intenta conectar a `/ws` y Nginx publica `/tiempo-real`; por eso el bloque de tiempo real de esta defensa debe mostrarse con la prueba automatizada hasta que se alineen esas rutas. La prueba está en `tests/ms-viajes/tiempo-real.test.ts` y cubre handshake, autorización, eventos y reconexión.

## Cronograma

| Tiempo | Presentación | Acción y evidencia |
|---|---|---|
| 0:00–1:00 | Problema y arquitectura | Explicar pasajero → gateway → `ms-viajes`; cotización con `ms-tarifas`; candidatos con `ms-flota`; PostgreSQL como fuente de verdad. |
| 1:00–2:00 | Sistema levantado | Mostrar los servicios saludables, `/health`, `/ready/*` y la interfaz local en `5173`. |
| 2:00–4:00 | Pasajero y Variante A | Ingresar con el token de pasajero. Solicitar origen/destino y señalar precio en ARS, multiplicador, factores y vigencia de tres minutos. Aclarar que el precio lo calcula el servidor. |
| 4:00–5:00 | Confirmación idempotente | Confirmar el viaje y mostrar el precio congelado. En `requests/flujo-e2e.http`, repetir la confirmación con la misma `Clave-Idempotencia` y comparar el `id_viaje`. |
| 5:00–7:00 | Chofer y oferta | Abrir el perfil separado del chofer, actualizar ubicación y disponibilidad, obtener la oferta, aceptarla y avanzar llegada/inicio. El endpoint es el estado canónico; si la ruta WS todavía no está alineada, describir la prueba automatizada sin afirmar que el evento se vio en vivo. |
| 7:00–8:00 | Soporte | Mostrar `GET /viajes` con el token local de soporte y explicar que su rol habilita supervisión. Intentar acceder a un viaje con otro pasajero debe responder `403 VIAJE_NO_AUTORIZADO`. |
| 8:00–10:00 | Finalización y cobro | El chofer finaliza. El primer cobro simulado queda `fallido`; pasajero y chofer consultan `GET /viajes/{id}/cobro`. Pasajero titular o soporte reintenta con `Clave-Idempotencia`; el mismo cobro pasa a `confirmado`, mantiene su ID y conserva el importe final. |
| 10:00–12:00 | Falla controlada | En terminal ejecutá `docker compose stop ms-flota`. Mostrá `/ready/flota` y la respuesta segura `503 DEPENDENCIA_NO_DISPONIBLE` de una operación que requiere candidatos. Restaurá con `docker compose start ms-flota`; repetir la operación con la misma clave idempotente no duplica el viaje. |
| 12:00–13:00 | Intento bloqueado y observabilidad | Como pasajero, intentá cambiar la disponibilidad de un chofer: debe responder `403 ROL_NO_AUTORIZADO`. Mostrar los tests RBAC y, si la traza se generó, buscar el error en Jaeger (`http://localhost:16686`). |
| 13:00–15:00 | Cierre | Resumir invariantes: precio calculado por servidor, un chofer por viaje activo, cobro único, acceso por rol/recurso y dependencias con fallos controlados. Mencionar las limitaciones documentadas. |

## Secuencia REST del viaje

El archivo [`requests/flujo-e2e.http`](../requests/flujo-e2e.http) es la fuente operativa para los pasos de viaje. Ejecutalo solicitud por solicitud con VS Code REST Client:

1. El chofer carga ubicación y disponibilidad.
2. El pasajero pide estimación y confirma con una clave idempotente.
3. El chofer lista y acepta la oferta.
4. El chofer marca llegada, inicio y finalización.
5. El pasajero consulta el recibo y reintenta el cobro fallido con una clave.
6. Se repite el reintento con la misma clave y se comprueba que devuelve el mismo resultado.

Después de la finalización, el recibo incluye ID del cobro, importe como cadena exacta, moneda, estado, intentos y fecha. `precio_final` del viaje debe coincidir con `cobro.importe`.

## Caída de dependencia y recuperación

[`requests/fallas.http`](../requests/fallas.http) contiene las solicitudes de falla y recuperación. Para una demostración acotada:

```powershell
docker compose stop ms-flota
Invoke-RestMethod http://localhost:8080/ready/flota
```

La operación que consulta candidatos debe responder `503` con el sobre uniforme. Luego recuperá el servicio:

```powershell
docker compose start ms-flota
Invoke-RestMethod http://localhost:8080/ready/flota
```

Repetí la confirmación fallida con la misma `Clave-Idempotencia` según `requests/fallas.http`. El sistema debe completar o devolver el resultado guardado, sin un viaje duplicado.

## Ataque bloqueado

Con el token falso de pasajero en modo local de desarrollo:

```http
PATCH http://localhost:8080/choferes/yo/disponibilidad
Authorization: Bearer <token-pasajero-de-requests/flujo-e2e.http>
Content-Type: application/json

{"disponibilidad":true}
```

El resultado esperado es `403 ROL_NO_AUTORIZADO`. Para probar acceso por recurso, intentá consultar el viaje de otro pasajero y comprobá `403 VIAJE_NO_AUTORIZADO`. Las pruebas criptográficas RS256 de firma alterada y token vencido están registradas en [`ataque.md`](ataque.md) y en la suite; el modo falso no representa validación criptográfica.

## Si algo no está disponible durante el ensayo

- Si la readiness falla, revisar `docker compose ps` y `docker compose logs <servicio>`.
- Si la base usa un volumen anterior, los scripts de `/docker-entrypoint-initdb.d` no vuelven a ejecutarse; revisar el procedimiento del README y aplicar el esquema que falta.
- No borrar el volumen de PostgreSQL para corregir una demo sin confirmar que se pueden descartar esos datos.
- Si no hay Docker disponible, presentar la suite `npm.cmd test` como evidencia automatizada, y declarar que la prueba de clon limpio y la ejecución integrada quedan pendientes; no afirmar que Compose fue levantado.
