# Guion de demostración — Plataforma de viajes

**Duración estimada:** 12–15 minutos  
**Objetivo:** mostrar el login RS256, los roles, la Variante A con Modo Desarrollador, Modo Oscuro y `"Centrar mapa"`, el ciclo del viaje en tiempo real, cobro, pruebas de stress con `k6` y observabilidad distribuida en **Grafana Cloud** (y Jaeger local).

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

Para mostrar la interfaz, podés abrir directamente `http://localhost:8080/` servida por Nginx desde el mismo gateway (o, si preferís hot-reload de desarrollo, abrir otra terminal con `npm.cmd run dev:web` y entrar a `http://localhost:5173`). El cliente web se comunica con el gateway local en `8080` tanto por HTTP como por WebSocket (`/ws` / `/tiempo-real`).

En la pantalla de ingreso (`/#/login`) usá el formulario principal de **usuario y contraseña** con las cuentas semilla emitidas por `auth-emulator` en RS256 (`ana`, `carlos`, `lucia`, `martin` con clave `ViajesDemo2026!`), o bien el bloque colapsable secundario de perfiles rápidos de demostración. Los tokens falsos (`JWT_MODO=falso`) quedan estrictamente bloqueados en producción. Para mantener pasajero y chofer conectados a la vez, usá dos perfiles de navegador separados. Nginx sirve la SPA en `/` y reenvía el upgrade WebSocket tanto en `/tiempo-real` como en `/ws` hacia `ms-viajes`; además, la suite completa (`npm.cmd test` + `npx playwright test`) corre automáticamente en `.github/workflows/ci.yml`.

## Cronograma

| Tiempo | Presentación | Acción y evidencia |
|---|---|---|
| 0:00–1:00 | Problema y arquitectura | Explicar pasajero → gateway Nginx → `ms-viajes`, `ms-tarifas`, `ms-flota`; PostgreSQL como fuente de verdad y arquitectura hexagonal. |
| 1:00–2:00 | Sistema levantado y login RS256 | Mostrar `/health`, `/ready/*`, la UI en `http://localhost:8080/`, CSP estricta sin violaciones en consola y el login con usuario/contraseña (`ana` / `ViajesDemo2026!`). |
| 2:00–4:30 | Pasajero, Leaflet, Modo Oscuro y Modo Desarrollador | Mostrar destino en blanco, clic/arrastre en mapa (geocodificación inversa), `"Centrar mapa"`, selector de **Modo Oscuro** en el header y **Modo Desarrollador** (simular hora nocturna + lluvia + demanda viendo modificadores `[0.75, 2.00]` y recomendaciones). |
| 4:30–5:30 | Confirmación idempotente | Confirmar el viaje (`Clave-Idempotencia`) y mostrar el precio congelado. |
| 5:30–7:30 | Chofer y tiempo real (Tema 20) | Abrir perfil del chofer (`carlos`), activar disponibilidad, recibir oferta en vivo por WebSocket (`/ws` / `/tiempo-real`), aceptar y avanzar estados hasta finalizar. |
| 7:30–9:00 | Cobro y panel Operador/Admin | Consultar recibo, reintentar cobro fallido con idempotencia; mostrar vistas de Soporte (`lucia`) y Admin (`martin`, reglas versionadas). |
| 9:00–11:00 | Stress con `k6` y falla controlada | Mostrar resultados de `npm.cmd run carga:k6:smoke` / `carga:k6` (hasta `240,31 req/s`, `0,00 %` errores `5xx`) y simular caída con `docker compose stop ms-flota` (`503 DEPENDENCIA_NO_DISPONIBLE`). |
| 11:00–13:00 | Observabilidad en Grafana Cloud (Tema 18) y Seguridad (Tema 19) | Mostrar trazas, métricas HTTP y logs correlacionados en **Grafana Cloud** (y fallback local en Jaeger `:16686`), más validación RS256/RBAC (`403 ROL_NO_AUTORIZADO`). |
| 13:00–15:00 | Cierre | Resumir invariantes: precio calculado por servidor, un chofer por viaje activo, cobro único, idempotencia transaccional (`pg_advisory_xact_lock`) y CI en verde. |

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

## Pruebas de stress (`k6`), observabilidad y control RBAC

En Sprint 2 las pruebas de stress con `k6` reemplazan los ataques cruzados:

```powershell
npm.cmd run carga:k6:smoke
npm.cmd run carga:k6
```

Los resultados y umbrales SLA están registrados en [`mediciones.md`](mediciones.md). Para observar trazas, métricas y logs en **Grafana Cloud** (o Jaeger local en `:16686`), seguir los pasos de [`demo-observabilidad.md`](demo-observabilidad.md). Para demostrar control de acceso RBAC, intentar `PATCH http://localhost:8080/choferes/yo/disponibilidad` con el token de pasajero debe responder `403 ROL_NO_AUTORIZADO`.

## Si algo no está disponible durante el ensayo

- Si la readiness falla, revisar `docker compose ps` y `docker compose logs <servicio>`.
- Si la base usa un volumen anterior, los scripts de `/docker-entrypoint-initdb.d` no vuelven a ejecutarse; revisar el procedimiento del README y aplicar el esquema que falta.
- No borrar el volumen de PostgreSQL para corregir una demo sin confirmar que se pueden descartar esos datos.
- Si no hay Docker disponible, presentar la suite `npm.cmd test` como evidencia automatizada, y declarar que la prueba de clon limpio y la ejecución integrada quedan pendientes; no afirmar que Compose fue levantado.
