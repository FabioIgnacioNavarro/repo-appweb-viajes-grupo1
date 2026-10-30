# Plan de mediciones de carga y búsqueda de Flota

## Objetivo e hipótesis

Medir de forma reproducible la recepción de ubicaciones y la búsqueda de choferes cercanos en `ms-flota`, con PostgreSQL como fuente de verdad. La carga de referencia representa 500 choferes que informan su ubicación cada dos segundos: **250 actualizaciones por segundo**. Durante esa carga también se ejecuta una búsqueda de cercanos por segundo para observar la competencia entre escrituras y lecturas.

La hipótesis inicial es que el servicio puede sostener esa carga durante cinco minutos sin superar los umbrales de latencia, errores, event loop y memoria definidos aquí. Estos valores son objetivos de aceptación del proyecto para un entorno académico reproducible; no son resultados medidos ni una garantía de producción. Se fijan antes de ejecutar las pruebas y no se ajustan después para hacer coincidir los resultados.

## Umbrales iniciales de aceptación

Cada solicitud válida se mide de extremo a extremo en el gateway. Los resultados del proceso, gateway y base se registran por separado cuando la herramienta lo permita.

| Indicador | Objetivo inicial | Interpretación |
|---|---:|---|
| `POST /choferes/yo/ubicacion`, latencia p95 | ≤ 300 ms | El 95 % de las actualizaciones debe responder en este tiempo o menos. |
| `POST /choferes/yo/ubicacion`, latencia p99 | ≤ 600 ms | El 99 % debe responder en este tiempo o menos. |
| `GET /choferes/cercanos`, latencia p95 | ≤ 300 ms | Mide la búsqueda pública, incluida la verificación de ocupación entre servicios. |
| `GET /choferes/cercanos`, latencia p99 | ≤ 600 ms | Detecta demoras en la cola larga de búsquedas. |
| Solicitudes válidas exitosas | ≥ 99,5 % | Se cuentan respuestas esperadas `2xx`; una respuesta incorrecta o un error de infraestructura cuenta como fallo. |
| Throughput de actualizaciones | ≥ 250 solicitudes/s | La prueba debe completar la frecuencia ofrecida por los 500 choferes; no alcanza con generar carga y descartar pedidos. |
| Gateway `GET /health`, latencia p95 | ≤ 100 ms | Comprueba que la entrada pública siga respondiendo; no se interpreta como health de Flota. |
| Gateway `GET /ready/flota`, latencia p95 | ≤ 300 ms | Comprueba la readiness de Flota, incluida su consulta a PostgreSQL. |
| Éxito de sondas `/health` y `/ready/flota` | ≥ 99,9 % | Ninguna caída del gateway, Flota o PostgreSQL debe ocultarse en el promedio de las solicitudes de negocio. |
| Lag del event loop, p99 | ≤ 50 ms | Se mide dentro de `ms-flota` con `monitorEventLoopDelay`. |
| Lag máximo del event loop | ≤ 200 ms | Un pico mayor se registra como incumplimiento aunque el p99 pase. |
| Memoria RSS de `ms-flota` | ≤ 512 MiB | Se registra luego del calentamiento y durante toda la fase medida. |
| Crecimiento de RSS | ≤ 10 % entre el minuto 2 y el minuto 5 | Ayuda a detectar crecimiento sostenido; se compara el promedio de cada minuto, no dos muestras aisladas. |
| `POST /viajes`, latencia p50 | ≤ 1 s | Solo aplica al escenario integrado bajo carga; mide la respuesta a la confirmación. |
| `POST /viajes`, latencia p95 | ≤ 3 s | Se mide con dependencias sanas y sin fallas inducidas. |
| `POST /viajes`, latencia p99 | ≤ 5 s | Detecta demoras extremas de la solicitud integrada. |
| Solicitud hasta asignación, p95 | ≤ 5 s | Desde el inicio de `POST /viajes` hasta que un chofer de prueba acepta la oferta y el viaje queda asignado. |
| Solicitud hasta asignación, p99 | ≤ 8 s | Se mide con aceptación automática inmediata; no incluye tiempo humano de espera. |

Las métricas de `/viajes` y del tiempo hasta asignación pertenecen a la prueba integrada de los tres servicios, no al benchmark aislado de Flota. Si `ms-viajes` todavía no tiene persistencia lista, se informa ese resultado como bloqueado o no medible y no se atribuye a Flota.

## Escenarios

Se comparan versiones con el mismo conjunto de datos y la misma carga:

1. **Reposo:** servicios iniciados, sin actualizaciones, una búsqueda por segundo y sondas de salud. Sirve como referencia de latencia sin competencia de escrituras.
2. **Línea de base actual:** código de `ms-flota` de `main` registrado por su SHA antes de cambiar la estrategia. Para este inicio se registra `203451f`; en esta versión, PostgreSQL filtra por disponibilidad, antigüedad y cuadro geográfico, calcula Haversine en la consulta y limita los candidatos.
3. **Referencia ingenua:** variante solo de benchmark que carga los choferes elegibles y calcula distancias en Node.js. No se publica como ruta de producción. Se implementa en el simulador para comparar la solución inicial con la final sin exponer una ruta deliberadamente costosa a clientes.
4. **Versión final:** estrategia de búsqueda optimizada que el grupo elija después de comparar alternativas. Se registra el commit exacto y la estrategia; no se presupone que sea PostGIS, geohash ni memoria antes de contar con evidencia.
5. **Flujo integrado:** estimación, confirmación, creación de ofertas y aceptación automática de una oferta de prueba a través de los servicios y el gateway. Se ejecuta por separado de la medición de Flota y se informa qué servicios y proveedores estuvieron activos.

La comparación principal será entre la línea de base actual y la versión final. La variante ingenua se informa aparte para mostrar el costo de la implementación sin prefiltrado. No se mezclan datos de escenarios distintos en una misma distribución.

## Carga y duración

- Crear 500 identidades de chofer deterministas, sin datos personales, habilitadas y con carnet validado. Usar un token de prueba distinto por chofer en modo desarrollo; nunca usar credenciales reales.
- Preparar ubicaciones iniciales válidas y recientes, distribuidas determinísticamente en un radio de 5 km alrededor de Resistencia. Mantener la misma semilla y posiciones entre ejecuciones.
- Cada chofer envía `POST /choferes/yo/ubicacion` una vez cada dos segundos. El simulador reparte las 500 primeras solicitudes a lo largo del intervalo para alcanzar aproximadamente 250 solicitudes/s sin crear un pico artificial al inicio de cada ciclo.
- En paralelo, un pasajero de prueba consulta `GET /choferes/cercanos` una vez por segundo, con origen y radio fijos. También se consulta `GET /health` y `GET /ready/flota` una vez por segundo desde un cliente independiente. El primero verifica Nginx; el segundo comprueba Flota y PostgreSQL.
- Calentar el sistema durante 60 segundos; medir durante cinco minutos; dejar 60 segundos de recuperación y guardar métricas finales. Una ejecución de carga completa ofrece 75.000 actualizaciones medidas, 300 búsquedas y 300 sondas de cada endpoint de salud.
- Ejecutar tres repeticiones por escenario. Hacerlas secuencialmente, con la misma configuración, semilla, límites de pool y volumen de base. Alternar el orden de la línea de base y la versión final para reducir el sesgo por temperatura o carga del equipo.
- No generar tráfico hacia el endpoint público de OSRM ni hacia proveedores meteorológicos durante estas mediciones. La carga debe limitarse a los servicios locales y controlados.

## Procedimiento reproducible

1. Registrar el commit de cada variante, sistema operativo, CPU, RAM, versiones de Node.js, Docker y PostgreSQL, configuración de Compose, `DATABASE_POOL_MAX` y cualquier límite de recursos activo.
2. Preparar un entorno local aislado y un `.env` local no versionado con `NODE_ENV=development` y `JWT_MODO=falso`. La prueba no debe conectarse a producción ni utilizar tokens reales.
3. Levantar PostgreSQL y los servicios con Docker Compose (`docker compose up --build -d`). Esperar a que los healthchecks estén sanos y confirmar `GET /health`, `GET /ready/flota` y la prueba E2E (`$env:E2E_BASE_URL = "http://localhost:8080"; npm.cmd run test:e2e`) antes de medir. Si la E2E falla, detener la medición y corregir primero el entorno.
4. Reiniciar la base de prueba hasta un estado conocido y cargar las 500 identidades de forma idempotente. El mecanismo de preparación y limpieza del simulador debe afectar solo los IDs de prueba; no usar `docker compose down -v` como limpieza general porque elimina el volumen de PostgreSQL.
5. Ejecutar el escenario de reposo y luego los escenarios de carga definidos arriba. Guardar el registro bruto de cada ejecución junto con el SHA, la semilla y la configuración; no conservar tokens ni coordenadas exactas en logs compartidos.
6. Repetir tres veces cada escenario. Si una ejecución se interrumpe, conservarla marcada como inválida con el motivo y volver a ejecutarla; no reemplazarla en silencio.
7. Comparar p50, p95 y p99 por tipo de solicitud, throughput ofrecido y completado, tasa de error, lag del event loop, RSS, uso de CPU, conexiones activas de PostgreSQL y tiempo de primera oferta cuando corresponda. Reportar cada repetición y la mediana de las tres; no mostrar solo el promedio.
8. Aceptar una variante únicamente si las tres repeticiones alcanzan el throughput ofrecido y cumplen los umbrales de latencia, errores, salud, lag y memoria. Si no los cumple, registrar el incumplimiento y la siguiente hipótesis de mejora antes de volver a medir.

El simulador y cualquier script de preparación deberán quedar versionados en `carga/`. Todavía no hay un comando de benchmark porque el simulador no está implementado; ese comando exacto se agregará junto con MED-001. La carga se ejecutará contra el gateway para reflejar el camino público. Si se agrega una medición directa a `ms-flota`, se informará por separado y no se comparará con mediciones tomadas a través de Nginx.

## Métricas a conservar

| Métrica | Unidad | Se registra por |
|---|---:|---|
| Latencia p50, p95 y p99 | ms | Endpoint y escenario |
| Solicitudes ofrecidas, completadas y fallidas | req/s y cantidad | Endpoint y repetición |
| Porcentaje de errores y códigos HTTP | % y cantidad | Endpoint y repetición |
| Latencia p50, p95 y p99 de `POST /viajes` | ms | Solo flujo integrado |
| Tiempo desde la solicitud hasta la asignación aceptada | ms | Solo flujo integrado, con aceptación automática |
| Lag p99 y máximo del event loop | ms | Proceso `ms-flota` |
| Memoria RSS y crecimiento durante la prueba | MiB y % | Proceso `ms-flota` |
| CPU, conexiones y consultas PostgreSQL | %, cantidad y duración | Host/base y repetición |
| Estado y latencia de `/health` y `/ready/flota` | código HTTP y ms | Cada sonda |

## Registro de resultados

Todavía no hay resultados medidos. Por cada variante se anotarán: commit, fechas, entorno, escenario, semilla, configuración, tres resultados individuales, mediana, cumplimiento de cada umbral, problemas observados y decisión tomada. Los umbrales anteriores se mantienen como referencia; si el grupo decide cambiarlos, debe justificarlo antes de una nueva serie y conservar los valores anteriores para que la comparación siga siendo honesta.
