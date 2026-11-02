# Plan de mediciones de carga y búsqueda de Flota

## Objetivo e hipótesis

Medir de forma reproducible la recepción de ubicaciones y la búsqueda de choferes cercanos en `ms-flota`, con PostgreSQL como fuente de verdad. La carga de referencia representa 500 choferes que informan su ubicación cada dos segundos: **250 actualizaciones por segundo**. Durante esa carga también se ejecuta una búsqueda de cercanos por segundo para observar la competencia entre escrituras y lecturas.

La hipótesis inicial es que el servicio puede sostener esa carga durante cinco minutos sin superar los umbrales de latencia, errores, event loop y memoria definidos aquí. Estos valores son objetivos de aceptación del proyecto para un entorno académico reproducible; no son resultados medidos ni una garantía de producción. Se fijan antes de ejecutar las pruebas y no se ajustan después para hacer coincidir los resultados.

**Alcance tras TIE-001:** las actualizaciones de Flota también intentan notificar a `ms-viajes` por HTTP interno para publicar ubicación a pasajeros con un viaje en curso. En las mediciones completas del sistema se debe levantar los tres servicios y registrar además latencia, errores y CPU/memoria de `ms-viajes`; las mediciones históricas de MED-001 corresponden a Flota y no incluyen este tráfico adicional.

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
3. **Referencia ingenua:** queda como comparación experimental separada. No se publicará como ruta de producción ni se comparará el CPU del generador con el CPU del servicio. El simulador MED-001 mide el recorrido HTTP real; la comparación ingenua se agregará cuando se defina la estrategia geográfica y exista un adaptador de benchmark con límites equivalentes.
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
3. Levantar PostgreSQL y los servicios con la configuración de mediciones, que habilita el registro de event loop solo para `ms-flota`:

   ```powershell
   docker compose -f docker-compose.yml -f carga/docker-compose.mediciones.yml up --build -d
   ```

   Esperar a que los healthchecks estén sanos y confirmar `GET /health`, `GET /ready/flota` y la prueba E2E (`$env:E2E_BASE_URL = "http://localhost:8080"; npm.cmd run test:e2e`) antes de medir. Si la E2E falla, detener la medición y corregir primero el entorno.
4. Ejecutar `npm.cmd run carga:flota -- --modo prueba` para verificar el entorno. En modo completo, el simulador crea perfiles sintéticos con UUID aleatorios y ubicaciones iniciales; limpia únicamente esos perfiles y ubicaciones al terminar. No se requiere borrar el volumen de PostgreSQL ni ejecutar `docker compose down -v`.
5. Ejecutar el escenario de reposo y luego los escenarios de carga definidos arriba. Cada ejecución genera un informe JSON local con SHA, semilla, configuración, métricas por endpoint, CPU/memoria y ventanas de event loop. El informe queda en `carga/resultados/`, que está excluida de Git; no contiene tokens ni coordenadas.
6. Repetir tres veces cada escenario. Si una ejecución se interrumpe, conservarla marcada como inválida con el motivo y volver a ejecutarla; no reemplazarla en silencio.
7. Comparar p50, p95 y p99 por tipo de solicitud, throughput ofrecido y completado, tasa de error, lag del event loop, RSS, uso de CPU, conexiones activas de PostgreSQL y tiempo de primera oferta cuando corresponda. Reportar cada repetición y la mediana de las tres; no mostrar solo el promedio.
8. Aceptar una variante únicamente si las tres repeticiones alcanzan el throughput ofrecido y cumplen los umbrales de latencia, errores, salud, lag y memoria. Si no los cumple, registrar el incumplimiento y la siguiente hipótesis de mejora antes de volver a medir.

El simulador y cualquier script de preparación están versionados en `carga/`. La carga se ejecuta contra el gateway para reflejar el camino público. Si se agrega una medición directa a `ms-flota`, se informará por separado y no se comparará con mediciones tomadas a través de Nginx.

### Comandos del simulador

Desde la raíz del repositorio y con Docker Compose levantado usando el archivo adicional de mediciones:

```powershell
# Prueba corta: 5 choferes, 2 s de calentamiento, 12 s medidos y 1 s de recuperación.
npm.cmd run carga:flota -- --modo prueba

# Reposo con valores completos.
npm.cmd run carga:flota -- --modo completa --escenario reposo --repeticion 1

# Carga completa: 500 choferes, 60 s de calentamiento, 300 s medidos y 60 s de recuperación.
npm.cmd run carga:flota -- --modo completa --escenario carga --repeticion 1 --semilla 42
```

Repetir la última orden con `--repeticion 2` y `--repeticion 3`, manteniendo la misma semilla. Para una variante distinta, conservar el mismo número de repetición y semilla. El simulador rechaza destinos HTTP que no sean locales, verifica que Docker use un contexto local, comprueba `/health` y `/ready/flota`, y no usa proveedores externos.

La latencia HTTP se mide desde que empieza la solicitud hasta que se consume la respuesta. La espera de la cola se registra aparte para detectar un generador atrasado. El lag del event loop y el RSS pertenecen al proceso `ms-flota`; CPU y memoria de `docker stats` pertenecen al contenedor completo y no se deben confundir con RSS.

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
| Heap usado, memoria externa y `ArrayBuffer` | MiB | Diagnóstico del proceso `ms-flota`; `arrayBuffers` es subconjunto de `external` y no se suma a ella |
| CPU, conexiones y consultas PostgreSQL | %, cantidad y duración | Host/base y repetición |
| Estado y latencia de `/health` y `/ready/flota` | código HTTP y ms | Cada sonda |

## Registro de resultados

Por cada variante se anotan commit, fechas, entorno, escenario, semilla, configuración, tres resultados individuales, mediana, cumplimiento de cada umbral, problemas observados y decisión tomada. Los umbrales se mantienen como referencia; si el grupo decide cambiarlos, debe justificarlo antes de una nueva serie y conservar los valores anteriores.

### Línea de base de carga de `ms-flota` — 2026-11-02

- **Código de búsqueda:** `203451f` (Haversine con prefiltrado por cuadro en PostgreSQL; sin cambios en `src/ms-flota` desde ese commit).
- **Commit del repositorio y simulador:** `b603a8f`.
- **Entorno:** Windows x64, Node del generador `v24.16.0`, contenedores Node 22, Docker `29.7.2`, PostgreSQL `16.15`, AMD Ryzen 5 7530U, 15.7 GiB RAM.
- **Configuración:** escenario de carga, 500 choferes, 60 s de calentamiento, 300 s medidos y 60 s de recuperación, semilla 42, gateway local y mediciones en `ms-flota` habilitadas.
- **Informes JSON locales:** `58c21f4e-8bbf-4938-af79-58fa4112d817`, `b936324e-d2ed-4c92-b664-a164bf941298` y `b3f6e382-c832-42f8-bcb9-cbce2c2c115d`. Los archivos se guardan en `carga/resultados/` y no se versionan.

| Repetición | Actualizaciones exitosas | Actualización p95 / p99 (ms) | Búsqueda p95 / p99 (ms) | Errores / cola perdida | CPU p95 (%) | Event loop p99 / máximo (ms) | RSS máximo (MiB) | Crecimiento RSS min. 2 a 5 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 74.999 / 75.000 (249,9967 req/s) | 12,46 / 75,53 | 25,50 / 141,55 | 0 / 0 | 61,69 | 27,77 / 45,48 | 143,24 | 2,05 % |
| 2 | 75.000 / 75.000 (250 req/s) | 19,03 / 116,85 | 34,60 / 209,35 | 0 / 0 | 61,91 | 30,46 / 49,94 | 150,08 | 7,21 % |
| 3 | 75.000 / 75.000 (250 req/s) | 14,65 / 169,29 | 28,02 / 244,44 | 0 / 0 | 60,37 | 29,18 / 33,78 | 148,73 | 12,77 % |
| **Mediana** | **75.000 / 75.000 (250 req/s)** | **14,65 / 116,85** | **28,02 / 209,35** | **0 / 0** | **61,69** | **29,18 / 45,48** | **148,73** | **7,21 %** |

Las tres repeticiones completaron 300/300 búsquedas, 300/300 sondas `/health` y 300/300 sondas `/ready/flota`, todas con HTTP 200; no hubo solicitudes perdidas por cola. La repetición 1 quedó una actualización por debajo de 75.000 (diferencia de 0,0033 req/s respecto del objetivo); las otras dos alcanzaron las 75.000. Las medianas de latencia de actualización y búsqueda quedaron debajo de sus umbrales.

La repetición 3 superó el umbral de crecimiento RSS de 10 % entre los minutos 2 y 5. El RSS máximo de las tres ejecuciones fue menor a 151 MiB (límite 512 MiB) y, aproximadamente dos minutos después de finalizar la prueba, el proceso bajó a 92,51 MiB. Esto apunta a crecimiento de memoria durante la carga que se recupera al cesar el tráfico; no elimina el incumplimiento del umbral de esa repetición. Por ello la línea de base está medida, pero MED-001 no se declara aceptada todavía.

La línea de base del escenario de carga quedó medida en tres repeticiones. Una ejecución superó el umbral de crecimiento RSS; la serie diagnóstica y comparación con la estrategia final seleccionada se registran al final de este documento.

### Línea de base en reposo de `ms-flota` — 2026-11-02

- **Código y entorno:** misma variante y entorno de la línea de base de carga anterior; commit de repositorio `87a64d6`, búsqueda sin cambios desde `203451f`.
- **Configuración:** 500 perfiles sintéticos preparados; sin actualizaciones de ubicación; una búsqueda y una sonda `/health` y `/ready/flota` por segundo; 60 s de calentamiento, 300 s medidos y 60 s de recuperación; semilla 42.
- **Informes JSON locales:** `6009526d-8776-4ab0-a1b0-4aac33c4c539`, `0a31325b-1e77-4e45-af5d-144c95b238e1` y `406f2154-574f-41ac-aa0c-290ce94460fc`.

| Repetición | Búsquedas exitosas | Búsqueda p95 / p99 (ms) | `/health` p95 / p99 (ms) | `/ready/flota` p95 / p99 (ms) | Errores / cola perdida | CPU p95 (%) | Event loop p99 / máximo (ms) | RSS máximo (MiB) | Crecimiento RSS min. 2 a 5 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 300 / 300 | 10,75 / 13,15 | 4,44 / 7,34 | 8,10 / 10,06 | 0 / 0 | 16,46 | 26,46 / 35,45 | 103,78 | -14,04 % |
| 2 | 300 / 300 | 11,24 / 15,96 | 5,02 / 8,94 | 8,33 / 11,56 | 0 / 0 | 15,68 | 27,44 / 28,95 | 106,40 | 0,12 % |
| 3 | 300 / 300 | 10,31 / 24,00 | 6,99 / 17,54 | 8,24 / 14,20 | 0 / 0 | 18,24 | 25,12 / 30,95 | 109,82 | 0,00 % |
| **Mediana** | **300 / 300** | **10,75 / 15,96** | **5,02 / 8,94** | **8,24 / 11,56** | **0 / 0** | **16,46** | **26,46 / 30,95** | **106,40** | **0,00 %** |

Las tres repeticiones completaron 300/300 búsquedas y 300/300 sondas por endpoint; todas respondieron HTTP 200 y no hubo solicitudes perdidas por cola. Las latencias p95/p99, CPU, event loop y RSS quedaron dentro de los umbrales. La corrida 1 redujo el RSS entre los minutos 2 y 5; las corridas 2 y 3 se mantuvieron prácticamente estables.

La línea de base tiene tres repeticiones válidas por escenario (reposo y carga). La estrategia final seleccionada en ADR 0041 también se volvió a medir tres veces con desglose de memoria y se compara con la línea de base al final de este documento.

### Diagnóstico de memoria del proceso

Las corridas anteriores registran RSS, pero no separan memoria del heap de Node y memoria externa. La instrumentación diagnóstica añade `heapUsed`, `external` y `arrayBuffers` a cada muestra de `ms-flota` y a los resúmenes p95/máximo del JSON. `arrayBuffers` forma parte de `external`; se informa aparte para identificar buffers, pero no debe sumarse de nuevo al total. Los informes previos no tienen estas columnas y no se deben comparar como si las hubieran medido.

#### Corrida diagnóstica de carga con desglose de memoria — 2026-11-02

- **Commit instrumentado:** `80247bb`; el cambio solo agrega muestras de memoria y resumen, no altera el flujo de ubicaciones ni la búsqueda.
- **Informe local:** `b7b9f1b1-267c-4054-837e-ba91140de32e`.
- **Configuración:** escenario carga, 500 choferes, 60 s de calentamiento, 300 s medidos, 60 s de recuperación y semilla 42.
- **Solicitudes:** 75.000/75.000 actualizaciones, 300/300 búsquedas y 300/300 sondas por endpoint; todas respondieron correctamente y no hubo errores ni pérdidas por cola.
- **Latencias p95/p99:** actualizaciones 15,20/117,12 ms; búsquedas 33,71/154,15 ms; `/health` 6,34/62,90 ms; `/ready/flota` 14,54/152,52 ms.
- **Proceso:** event loop p99/máximo 30,47/35 ms; RSS máximo 155,61 MiB; heap usado p95/máximo 42,55/58,68 MiB; memoria externa 4,31/4,39 MiB; `ArrayBuffer` 0,77/0,85 MiB.

| Memoria del proceso | Promedio min. 2 (MiB) | Promedio min. 5 (MiB) | Cambio |
|---|---:|---:|---:|
| RSS | 141,90 | 155,12 | +9,32 % |
| Heap usado | 31,97 | 31,89 | -0,25 % |
| Memoria externa | 3,95 | 3,95 | -0,07 % |
| `ArrayBuffer` (subconjunto de externa) | 0,39 | 0,40 | +1,69 % (0,01 MiB) |

Aproximadamente 95 s después de terminar la medición, una muestra posterior de proceso registró RSS 89,19 MiB, heap 19,85 MiB, externa 3,63 MiB y `ArrayBuffer` 0,09 MiB. Que el RSS aumente mientras heap y externa permanecen casi planos, y luego baje al cesar el tráfico, es compatible con un pico/transitorio de memoria del runtime; no prueba por sí solo que no exista una fuga. Las tres corridas diagnósticas, incluida esta, se comparan con la línea de base en la siguiente sección. La repetición 3 histórica de la línea de base permanece registrada con 12,77 %.

### Comparación: línea de base y estrategia final seleccionada

La estrategia final seleccionada por ARC-004/ADR 0041 es la consulta existente de PostgreSQL con prefiltrado por cuadro y Haversine. `src/ms-flota/postgres.ts` y el algoritmo no cambiaron respecto de la línea de base; la variante final incorpora únicamente la instrumentación de memoria de este trabajo. La comparación valida la estrategia elegida con una nueva serie y no afirma una mejora de algoritmo.

- **Commit medido:** `83b2d2b` (la imagen de `ms-flota` se construyó desde el mismo código de servicio; el commit intermedio siguiente solo actualizó documentación).
- **Informes JSON locales:** `b7b9f1b1-267c-4054-837e-ba91140de32e`, `c81683cd-d3d1-4952-9600-15bfe4d3708e` y `3e2fcc26-6910-4554-8bfc-11b54a95be9d`.
- **Configuración idéntica:** escenario de carga, 500 choferes, 60 s de calentamiento, 300 s medidos, 60 s de recuperación y semilla 42.

| Repetición final | Actualizaciones | Actualización p95 / p99 (ms) | Búsqueda p95 / p99 (ms) | Errores / cola perdida | CPU p95 (%) | Event loop p99 / máximo (ms) | RSS máximo (MiB) | Crecimiento RSS min. 2 a 5 | Crecimiento heap / externa |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 75.000 / 75.000 | 15,20 / 117,12 | 33,71 / 154,15 | 0 / 0 | 62,53 | 30,47 / 35,00 | 155,61 | 9,32 % | -0,25 % / -0,07 % |
| 2 | 75.000 / 75.000 | 26,50 / 195,71 | 40,45 / 223,30 | 0 / 0 | 64,34 | 33,69 / 48,30 | 143,49 | 3,05 % | -2,22 % / 0,22 % |
| 3 | 75.000 / 75.000 | 15,76 / 159,92 | 27,76 / 117,35 | 0 / 0 | 63,46 | 35,29 / 49,97 | 155,07 | 1,93 % | -5,03 % / 0,55 % |
| **Mediana** | **75.000 / 75.000** | **15,76 / 159,92** | **33,71 / 154,15** | **0 / 0** | **63,46** | **33,69 / 48,30** | **155,07** | **3,05 %** | **-2,22 % / 0,22 %** |

Las 900 búsquedas y las 900 sondas de cada tipo respondieron HTTP 200 en la serie final. Las latencias p95/p99, el event loop, el RSS máximo y el crecimiento RSS quedaron debajo de sus umbrales en las tres repeticiones.

| Indicador mediano | Línea de base | Estrategia final seleccionada | Cambio |
|---|---:|---:|---:|
| Actualización p95 / p99 (ms) | 14,65 / 116,85 | 15,76 / 159,92 | +7,6 % / +36,9 % |
| Búsqueda p95 / p99 (ms) | 28,02 / 209,35 | 33,71 / 154,15 | +20,3 % / -26,4 % |
| CPU p95 (%) | 61,69 | 63,46 | +2,9 % |
| Event loop p99 / máximo (ms) | 29,18 / 45,48 | 33,69 / 48,30 | +15,5 % / +6,2 % |
| RSS máximo (MiB) | 148,73 | 155,07 | +4,3 % |
| Crecimiento RSS min. 2 a 5 | 7,21 % | 3,05 % | -4,16 puntos porcentuales |
| Actualizaciones exitosas | 74.999–75.000 | 75.000 en cada repetición | Las tres finales completaron el volumen |

La serie diagnóstica registró crecimiento RSS de 9,32 %, 3,05 % y 1,93 %, mientras el heap usado no creció entre los minutos 2 y 5 y la memoria externa permaneció casi estable. Una de las corridas anteriores dio 12,77 %; por eso se conserva como incumplimiento observado, pero el desglose, la recuperación tras detener el tráfico y las tres repeticiones posteriores explican que fue un aumento transitorio del RSS y no muestran acumulación sostenida del heap de JavaScript. Esta interpretación es evidencia acotada del entorno medido, no una garantía sobre escalas o entornos diferentes.

No se aplicó una optimización al algoritmo de búsqueda: la consulta ya cumplía sus umbrales y ADR 0041 seleccionó mantenerla. El resultado final conserva esa estrategia, satisface los límites en tres repeticiones y no introduce PostGIS ni geohash sin evidencia de un cuello de botella.
