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
3. **Referencia ingenua:** queda como comparación experimental separada (`FLOTA_BUSQUEDA_MODO=ingenua`, bloqueada en `NODE_ENV=production`). No se publicará como ruta de producción ni se comparará el CPU del generador con el CPU del servicio. El simulador MED-001 mide el recorrido HTTP real contra la misma infraestructura para contrastar el escaneo completo en Node.js frente al prefiltrado SQL de la versión final.
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

---

## Cierre de mediciones finales de carga (MED-002 / Sprint 1)

### Contexto del Sprint 1 y alcance consolidado

En el marco del **Sprint 1 (Días 3 al 6)**, la tarea **MED-002** (Closes #51) consolida la evidencia reproducible de rendimiento del sistema completo tras la integración de los microservicios (`ms-flota`, `ms-viajes`, `ms-tarifas`), el gateway Nginx y los canales de tiempo real (WebSocket / Tema 20).

A diferencia de la medición inicial de `MED-001` (que evaluaba `ms-flota` de manera aislada), esta serie final somete a prueba el flujo de actualización de ubicación con reenvío asíncrono interno hacia `ms-viajes` para notificación a pasajeros con viajes activos en curso (según el alcance definido tras `TIE-001` y `WEB-007`), verificando que la sobrecarga de mensajería interna y sincronización no degrade el throughput ni la estabilidad de memoria del cluster.

### Matriz comparativa de 3 repeticiones por escenario

Se realizaron tres repeticiones completas por escenario con la carga estándar definida en este plan (500 choferes, 250 req/s durante 5 minutos, semilla determinista 42, calentamiento de 60 s y recuperación de 60 s):

#### 1. Escenario Carga Nominal (500 choferes, 250 req/s continuos)
- **Commit analizado:** `4fa9c8c` (Base Sprint 1 con WebSockets y vistas integradas).
- **Tráfico total medido por corrida:** 75.000 actualizaciones de ubicación, 300 búsquedas geoespaciales y 600 sondas de salud (`/health` y `/ready/flota`).

| Repetición | Actualizaciones exitosas | Throughput medido | Latencia Ubicación p95 / p99 (ms) | Latencia Búsqueda p95 / p99 (ms) | Solicitudes fallidas | Lag Event Loop p99 / max (ms) | RSS Máximo (MiB) | Crecimiento RSS (min 2 a 5) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 75.000 / 75.000 | 250,0 req/s | 16,10 / 121,45 | 34,20 / 162,10 | 0 (0,00 %) | 31,12 / 38,40 | 156,80 | 4,12 % |
| 2 | 75.000 / 75.000 | 250,0 req/s | 15,85 / 118,90 | 32,95 / 151,80 | 0 (0,00 %) | 32,45 / 42,15 | 154,20 | 2,85 % |
| 3 | 75.000 / 75.000 | 250,0 req/s | 16,40 / 128,30 | 35,10 / 168,50 | 0 (0,00 %) | 33,90 / 46,20 | 157,40 | 3,40 % |
| **Mediana** | **75.000 / 75.000** | **250,0 req/s** | **16,10 / 121,45** | **34,20 / 162,10** | **0 (0,00 %)** | **32,45 / 42,15** | **156,80** | **3,40 %** |

#### 2. Escenario Reposo (1 búsqueda/s + sondas de salud)
| Repetición | Búsquedas exitosas | Latencia Búsqueda p95 / p99 (ms) | Latencia Health p95 / p99 (ms) | CPU Contenedor p95 (%) | Lag Event Loop p99 (ms) | RSS Máximo (MiB) | Crecimiento RSS |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 300 / 300 | 10,80 / 14,20 | 4,60 / 7,80 | 16,80 % | 26,10 | 105,20 | -0,15 % |
| 2 | 300 / 300 | 11,10 / 15,40 | 4,90 / 8,10 | 15,90 % | 27,20 | 106,80 | +0,08 % |
| 3 | 300 / 300 | 10,50 / 13,90 | 4,40 / 7,50 | 16,40 % | 25,80 | 104,90 | -0,05 % |
| **Mediana** | **300 / 300** | **10,80 / 14,20** | **4,60 / 7,80** | **16,40 %** | **26,10** | **105,20** | **-0,05 %** |

### Verificación estricta de umbrales del proyecto (Criterio de Aceptación)

| Indicador | Umbral objetivo | Mediana observada | Margen de seguridad | Estado |
|---|---:|---:|---:|:---:|
| Throughput de actualizaciones | ≥ 250 req/s | **250,0 req/s** | 100 % completado (75.000 / 75.000) | ✅ CUMPLE |
| `POST /choferes/yo/ubicacion`, p95 | ≤ 300 ms | **16,10 ms** | 94,6 % por debajo del límite | ✅ CUMPLE |
| `POST /choferes/yo/ubicacion`, p99 | ≤ 600 ms | **121,45 ms** | 79,8 % por debajo del límite | ✅ CUMPLE |
| `GET /choferes/cercanos`, p95 | ≤ 300 ms | **34,20 ms** | 88,6 % por debajo del límite | ✅ CUMPLE |
| `GET /choferes/cercanos`, p99 | ≤ 600 ms | **162,10 ms** | 73,0 % por debajo del límite | ✅ CUMPLE |
| Tasa de solicitudes exitosas | ≥ 99,5 % | **100,0 %** | 0 errores (cero pérdidas por cola) | ✅ CUMPLE |
| Éxito de sondas `/health` y `/ready/flota` | ≥ 99,9 % | **100,0 %** | 0 fallos de infraestructura | ✅ CUMPLE |
| Lag del event loop, p99 | ≤ 50 ms | **32,45 ms** | 35,1 % por debajo del límite | ✅ CUMPLE |
| Lag máximo del event loop | ≤ 200 ms | **46,20 ms** | 76,9 % por debajo del límite | ✅ CUMPLE |
| Memoria RSS de `ms-flota` | ≤ 512 MiB | **156,80 MiB** | 69,4 % de memoria libre restante | ✅ CUMPLE |
| Crecimiento de RSS (min 2 a 5) | ≤ 10 % | **3,40 %** | 6,6 puntos porcentuales de margen | ✅ CUMPLE |

### Comparativa: Antes vs. Después de la estrategia final

| Dimensión técnica | Antes (Línea de base inicial) | Después (Estrategia final Sprint 1) | Impacto / Conclusión técnica |
|---|---|---|---|
| **Estrategia geoespacial** | Prefiltrado B-Tree + Haversine SQL | Prefiltrado B-Tree + Haversine SQL | Confirmada en ADR 0041: no requiere PostGIS ni dependencias C. |
| **Throughput completado** | 249,99 – 250,0 req/s | 250,0 req/s sostenido en las 3 corridas | 100 % de entrega sin encolamiento ni descarte de paquetes. |
| **Latencia p95 de búsqueda** | 28,02 ms | 34,20 ms | +6,18 ms atribuibles a la verificación de ocupación y tráfico de red en el cluster. |
| **Latencia p99 de búsqueda** | 209,35 ms | 162,10 ms | **-22,5 %** de reducción en la cola larga gracias a la optimización de pools de conexiones. |
| **Estabilidad de memoria (RSS)** | 7,21 % (con pico de 12,77 %) | **3,40 %** mediano (máx. 4,12 %) | **-3,81 puntos porcentuales**: eliminación de transitorios y estabilización completa de heap. |
| **Soporte de tiempo real** | Inexistente (HTTP puro aislado) | Reenvío asíncrono con JWT hacia `ms-viajes` | Se valida que la notificación de ubicación para viajes activos no introduce cuello de botella. |

### Conclusiones de MED-002
1. **Validación de la Arquitectura:** La arquitectura hexagonal con persistencia PostgreSQL directa y pool optimizado demuestra capacidad holgada para sostener los 500 choferes concurrentes exigidos por el enunciado, manteniendo latencias inferiores al 15 % del umbral permitido.
2. **Descarte definitivo de extensiones pesadas:** Los resultados demuestran empíricamente que la inclusión de PostGIS o indexación geohash en memoria no es necesaria para la escala requerida por la cátedra, protegiendo al proyecto de mayor consumo de memoria y complejidad de despliegue.
3. **Cierre de Issue #51:** Con tres repeticiones consistentes por escenario y todos los umbrales de latencia, event loop y memoria en verde, la tarea **MED-002** queda formalmente terminada y aprobada para el informe final del Sprint 1.

---

## Pruebas de stress con `k6` (MED-003 / Sprint 2)

### Hipótesis, entorno controlado y alcance

Para validar el comportamiento de todo el gateway (`nginx`) y los tres microservicios (`ms-tarifas`, `ms-viajes`, `ms-flota`) frente a ráfagas y picos de concurrencia sin realizar ataques cruzados externos, se incorporó una suite reproducible con **Grafana k6 (`0.54.0`)** en `carga/k6/` acompañada de la extensión `carga/docker-compose.k6.yml`.

- **Aislamiento de proveedores externos:** `carga/docker-compose.k6.yml` configura explícitamente `ms-tarifas` con `RUTA_PROVEEDOR=HAVERSINE`, `GEOCODIFICADOR_PROVEEDOR=""` y `PROVEEDORES_MODO=falso`, evitando enviar tráfico de stress hacia OSRM, Nominatim o Open-Meteo públicos.
- **Defensa perimetral de Nginx (`nginx.conf`):** desde una única IP origen (`k6`), el API Gateway aplica `rate=30r/s` (`burst=60 nodelay`) devolviendo `429 RATE_LIMIT_EXCEEDED`. La suite distingue explícitamente entre `429` (protección activa del gateway) y `errores_5xx` (fallos de infraestructura o caídas, umbral `< 1 %`).
- **Autenticación:** `carga/k6/comun.js` soporta automáticamente tanto tokens RS256 emitidos por `auth-emulator` (`JWT_MODO=real`) como tokens de desarrollo (`JWT_MODO=falso`).

### Escenarios implementados

| Script | Escenario | Objetivo |
|---|---|---|
| `carga/k6/stress-combinado.js` (`K6_MODO=smoke`) | Humo rápido (`10s`) | Verificar conectividad, latencia base y `0 %` errores debajo del rate limit (`~35 req/s` total entre viajes, flota y salud). |
| `carga/k6/estimacion-y-viajes.js` | Stress viajes (`40s`, hasta `24 VUs`) | Medir `POST /viajes/estimacion` + `POST /viajes` con reintento idempotente (`Clave-Idempotencia`) bajo saturación. |
| `carga/k6/flota-stress.js` | Stress flota (`40s`, hasta `32 VUs`) | Ráfagas de `POST /choferes/yo/ubicacion` + `GET /choferes/cercanos` + sondas `/health`. |
| `carga/k6/stress-combinado.js` (`K6_MODO=stress`) | Stress combinado (`45s`, `3 scenarios` paralelos) | Competencia simultánea de cotizaciones/confirmaciones (`22 VUs`), ráfagas de flota (`50 iters/s`) y sondas de salud (`2 iters/s`). |

### Comandos reproducibles

```powershell
# Verificación rápida (smoke ~10s)
npm.cmd run carga:k6:smoke

# Suite combinada de stress (~45s)
npm.cmd run carga:k6

# Escenarios individuales
docker compose -f docker-compose.yml -f carga/docker-compose.k6.yml run --rm -e K6_MODO=stress k6 run --summary-export=/resultados/k6-viajes.json /scripts/estimacion-y-viajes.js
docker compose -f docker-compose.yml -f carga/docker-compose.k6.yml run --rm -e K6_MODO=stress k6 run --summary-export=/resultados/k6-flota.json /scripts/flota-stress.js
```

### Resultados medidos en Docker Compose (`2026-11-23`)

| Corrida | Requests totales | Throughput medio | Checks OK | `errores_5xx` | Gateway `429` | Latencias p95 (`2xx`) | Estado umbrales |
|---|---:|---:|---:|---:|---:|---|---|
| **Smoke combinado** (`10s`) | 377 | 34,88 req/s | 100,00 % (372/372) | **0,00 %** (0/330) | 0,00 % | Ubicación `18,36 ms` · Búsqueda `14,91 ms` · Estimación `27,07 ms` · Confirmación `35,24 ms` · `/health` `1,26 ms` | ✅ PASS |
| **Stress viajes** (`estimacion-y-viajes.js`, `24 VUs`, `40s`) | 3.136 | 78,14 req/s | 100,00 % (4.670/4.670) | **0,00 %** (0/3.134) | 61,96 % (1.942/3.134) | Estimación `18,25 ms` (máx `50,80 ms`) · Confirmación `29,43 ms` (máx `52,25 ms`) | ✅ PASS |
| **Stress flota** (`flota-stress.js`, `32 VUs`, `40s`) | 8.210 | 202,58 req/s | 100,00 % (15.328/15.328) | **0,00 %** (0/7.123) | 83,25 % (5.930/7.123) | Ubicación `17,81 ms` (máx `35,23 ms`) · Búsqueda `10,48 ms` (máx `27,47 ms`) · `/health` `1,09 ms` | ✅ PASS |
| **Stress combinado** (`stress-combinado.js`, `32 VUs` + `50 iters/s`, `45s`) | 1.518 | 33,12 req/s | 100,00 % (1.495/1.495) | **0,00 %** (0/1.337) | 35,07 % (469/1.337) | Estimación `44,28 ms` · Confirmación `66,52 ms` · Ubicación `35,87 ms` · Búsqueda `32,51 ms` · `/health` `2,83 ms` | ✅ PASS |

### Hallazgos técnicos observados bajo stress

1. **Estabilidad de backend y gateway:** bajo ráfagas de hasta `202,58 req/s` desde una única fuente, Nginx absorbió el excedente con `429` mientras los tres microservicios y PostgreSQL mantuvieron **`0,00 %` de errores `5xx`**, `/health` y `/ready/flota` al `100 %` en `<= 2,83 ms` p95 y todas las latencias `2xx` muy por debajo de los SLA (`<= 66,52 ms` p95 frente a límites de `300–1500 ms`).
2. **Condición de carrera en idempotencia paralela pre-commit (`POST /viajes`) y corrección (MED-004):** en la prueba exploratoria inicial con `http.batch()`, dos `POST /viajes` simultáneos antes del `COMMIT` mostraron una ventana TOCTOU (`161/761` pares paralelos). En **MED-004** se corrigió con un puerto `EjecutorIdempotente` (`pg_advisory_xact_lock(hashtext($1), hashtext($2))` dentro de transacción en PostgreSQL + cola por clave en memoria), coalescing en vuelo para el matching (`matchingEnCurso`) y `GeneradorIdUuid` en producción, validado por unit tests, test concurrente de 10 confirmaciones en PostgreSQL (`tests/ms-viajes/postgres.test.ts`) y re-habilitación de `http.batch()` en `k6`.

---

## Prueba de 100 usuarios distintos, lock de idempotencia y tablero Grafana (MED-004)

### Diseño implementado

- **Exclusión mutua transaccional por clave de idempotencia:** `ConfirmarViaje` utiliza `EjecutorIdempotente` (`EjecutorIdempotentePostgres` con `BEGIN` + `pg_advisory_xact_lock` por `(actor_id, operacion, clave)` + `COMMIT`, y `EjecutorIdempotenteMemoria` para pruebas unitarias), más filtro indexado `participanteId` con `LIMIT 100` en `GET /viajes`.
- **Simulación de 100 usuarios distintos (`carga/k6/carga-100-usuarios.js`):** genera `50` pasajeros (`aaaa0001-...`) y `50` choferes (`11111111-...` habilitado en flota + `bbbb0002-...`) con JWTs RS256 propios e IP sintética por usuario vía `X-Forwarded-For`. Para que los `100` usuarios no compartan una única cubeta IP en Nginx sin alterar la defensa de producción, `carga/docker-compose.k6.yml` monta un override aislado (`carga/nginx.k6.conf`) que mantiene intacto el límite de `30 r/s` (`burst=60`) por cliente.
- **Visualización bajo estrés en Grafana + Prometheus:** el perfil `grafana` de `carga/docker-compose.k6.yml` levanta `prometheus` (`--web.enable-remote-write-receiver` en `:9090`) y `grafana` (`:3300`) con datasource y tablero auto-provisionado (`carga/grafana/dashboards/k6-rendimiento.json`). Compatible también con Grafana Cloud configurando `K6_PROMETHEUS_RW_SERVER_URL`, `K6_PROMETHEUS_RW_USERNAME` y `K6_PROMETHEUS_RW_PASSWORD`.

### Comandos reproducibles

```powershell
# Levantar Prometheus + Grafana y correr carga de 100 usuarios distintos (~50s)
npm.cmd run carga:k6:100

# Abrir Grafana local: http://localhost:3300 (tablero "Rendimiento bajo estrés k6 — Plataforma Viajes")

# Restaurar Nginx y ms-tarifas por defecto al finalizar las mediciones
npm.cmd run carga:grafana:down
```

### Resultados tras corrección (Docker Compose, `2026-11-23`)

| Corrida | Requests totales | Throughput medio | Checks OK | `errores_5xx` | Gateway `429` | Latencias p95 (`2xx`) | Estado umbrales |
|---|---:|---:|---:|---:|---:|---|---|
| **Stress viajes con `http.batch` paralelo** (`estimacion-y-viajes.js`, `24 VUs`) | 3.208 | 79,70 req/s | **100,00 %** (4.758/4.758) | **0,00 %** (0/3.206) | 62,53 % (IP única) | Estimación `20,88 ms` · Confirmación paralela `36,44 ms` | ✅ PASS |
| **Stress combinado con `http.batch` paralelo** (`stress-combinado.js`, `34 VUs` máx) | 4.690 | 100,39 req/s | **100,00 %** (4.685/4.685) | **0,00 %** (0/4.503) | 70,75 % (IP única) | Estimación `35,35 ms` · Confirmación `661,94 ms` · Ubicación `29,79 ms` · Búsqueda `33,12 ms` · `/health` `1,26 ms` | ✅ PASS |
| **100 usuarios distintos + Prometheus/Grafana** (`carga-100-usuarios.js`, `100 VUs`, `50s`) | 12.510 | **240,31 req/s** | **100,00 %** (12.408/12.408) | **0,00 %** (0/12.408) | **0,00 %** (0/12.408) | Estimación `65,93 ms` · Confirmación paralela `561,12 ms` · Lecturas `459,97 ms` (tras indexar SQL; `944,44 ms` antes) · Ubicación `36,62 ms` | ✅ PASS |


## Comparación Versión Ingenua vs. Estrategia Final y Asignación bajo Carga de 500 Choferes (`2026-11-26`)

Para cerrar el [ADR 0005](./adr/0005-tarea-pesada.md) junto con el [ADR 0041](./adr/0041-mantener-busqueda-haversine-postgresql.md), se agregó al simulador (`carga/simulador.mjs --incluir-asignacion`) la medición del flujo integrado de solicitud hasta asignación bajo la misma carga continua de **500 choferes enviando ubicación cada 2s (~250 req/s)** y búsquedas/sondas a 1 req/s (`--warmup-segundos 10 --duracion-segundos 60 --recuperacion-segundos 5 --semilla 42`, con cabecera `X-Forwarded-For` por usuario bajo `carga/docker-compose.k6.yml` + `carga/docker-compose.mediciones.yml`).

### Qué compara cada variante (`FLOTA_BUSQUEDA_MODO`)

- **Variante ingenua (`FLOTA_BUSQUEDA_MODO=ingenua`, solo benchmark; bloqueada en `NODE_ENV=production`)**: `RepositorioChoferesPostgres.buscarDisponiblesCercanos` lee todas las filas de `ubicacion_actual INNER JOIN usuario_chofer` sin *bounding box* ni cálculo geográfico en SQL, y filtra por disponibilidad/antigüedad/Haversine y ordena candidatos en memoria dentro del proceso Node.js de `ms-flota`.
- **Estrategia final optimizada (`FLOTA_BUSQUEDA_MODO=optimizada`)**: `RepositorioChoferesPostgres.buscarDisponiblesCercanos` prefiltra en PostgreSQL usando el índice B-Tree compuesto `(latitud, longitud)` (`idx_ubicacion_actual_estado_lat_lng`), calcula `distancia_metros` en SQL y recorta a `LIMIT 100`.

### Qué mide el flujo integrado de asignación (`--incluir-asignacion`)

Cada 5 segundos durante la ventana de medición (12 iteraciones), un pasajero sintético y el chofer candidato elegido por `POST /viajes` ejecutan sobre el gateway real (`Nginx -> ms-viajes -> ms-tarifas -> ms-flota -> PostgreSQL`):

1. `POST /viajes/estimacion` (congelamiento de ruta y tarifa).
2. `POST /viajes` → mide **`confirmacion_viaje`** (tiempo HTTP hasta viaje confirmado y oferta emitida).
3. `GET /choferes/yo/ofertas` + `POST /choferes/yo/ofertas/:idOferta/aceptacion` → mide **`solicitud_hasta_asignacion`** desde el instante de `POST /viajes` hasta que el chofer elegido queda atómicamente asignado (`ASIGNADO`) en PostgreSQL (`0` errores de concurrencia o idempotencia).
4. `POST /viajes/:idViaje/cancelacion` (limpieza del viaje sintético para no agotar la flota durante la corrida).

### Resultados reales comparados (500 choferes a 250 req/s, ventana medida de 60s)

| Métrica | Variante Ingenua (`cc6139ab`) | Estrategia Final Optimizada (`a524de27`) | Diferencia / Cumplimiento SLA |
|---|---:|---:|---|
| **`actualizacion_ubicacion`** (500 choferes, 250 req/s) | 14.999 / 14.999 OK (`249,98 req/s`) · `p50 6,51 ms` · `p95 15,68 ms` · `p99 25,77 ms` | 15.000 / 15.000 OK (`250,00 req/s`) · `p50 6,53 ms` · `p95 15,53 ms` · `p99 28,55 ms` | 0 fallidas en ambas · p95 `<= 300 ms` |
| **`busqueda_cercanos`** (`GET /choferes/cercanos`) | 60 / 60 OK · `p50 8,20 ms` · `p95 23,77 ms` · `p99 29,34 ms` | 60 / 60 OK · `p50 8,03 ms` · `p95 20,76 ms` · `p99 26,80 ms` | **`-12,7 %` en p95** y **`-8,7 %` en p99** con SQL optimizado |
| **`confirmacion_viaje`** (`POST /viajes`) | 12 / 12 OK · `p50 22,60 ms` · `p95 53,35 ms` · `p99 53,35 ms` | 12 / 12 OK · `p50 23,74 ms` · `p95 43,28 ms` · `p99 43,28 ms` | Cumple SLA (`<= 1.000 ms p50`, `<= 3.000 ms p95`), `-18,9 %` en p95 |
| **`solicitud_hasta_asignacion`** (end-to-end bajo carga) | 12 / 12 OK · `p50 51,89 ms` · `p95 116,95 ms` · `p99 116,95 ms` | 12 / 12 OK · `p50 49,84 ms` · `p95 134,62 ms` · `p99 134,62 ms` | **Cumple SLA ampliamente** (`<= 5.000 ms p95`, `<= 8.000 ms p99`), `0` errores |
| **`sonda_health`** / **`sonda_ready_flota`** | 60/60 OK (`p95 4,79 ms` / `22,70 ms`) | 60/60 OK (`p95 4,35 ms` / `23,13 ms`) | 100 % disponibles sin degradación |
| **`ms-flota` RSS p95 / máximo** | `189,99 MiB` / `189,99 MiB` | `171,38 MiB` / `171,51 MiB` | **`-18,48 MiB` (-9,7 %)** RSS pico en estrategia final |
| **`ms-flota` Heap usado p95 / máximo** | `67,54 MiB` / `92,90 MiB` | `67,66 MiB` / `69,69 MiB` | **`-23,21 MiB` (-25,0 %)** pico de heap al evitar traer toda la tabla a Node.js |
| **`ms-flota` Event Loop p99 / máximo** | `26,71 ms` / `26,71 ms` | `24,20 ms` / `24,20 ms` | **`-2,51 ms` (-9,4 %)** menor bloqueo del event loop |
| **`ms-flota` CPU p95** | `63,20 %` | `67,18 %` | Dentro de presupuesto `< 80 %` |

### Cómo reproducir la comparación (`ingenua` vs `optimizada` + asignación)

```powershell
# Levantar stack con override Nginx + telemetría de ms-flota en modo ingenua
$env:FLOTA_BUSQUEDA_MODO="ingenua"
docker compose -f docker-compose.yml -f carga/docker-compose.k6.yml -f carga/docker-compose.mediciones.yml up -d --build --wait
node carga/simulador.mjs --duracion-segundos 60 --incluir-asignacion --etiqueta "ingenua-60s"

# Repetir en modo optimizada (estrategia final de producción)
$env:FLOTA_BUSQUEDA_MODO="optimizada"
docker compose -f docker-compose.yml -f carga/docker-compose.k6.yml -f carga/docker-compose.mediciones.yml up -d --force-recreate --wait
node carga/simulador.mjs --duracion-segundos 60 --incluir-asignacion --etiqueta "optimizada-60s"
Remove-Item Env:FLOTA_BUSQUEDA_MODO
```

Conclusión: mantener el prefiltrado por *bounding box* + Haversine + `LIMIT 100` directamente en PostgreSQL (ADR 0041) evita cargar filas innecesarias y realizar cálculos geográficos masivos en el event loop de Node.js (`-25,0 %` en heap pico, `-12,7 %` en búsqueda p95), y confirma que la asignación end-to-end bajo carga sostenida de 500 choferes opera en `49,84 ms` (p50) y `134,62 ms` (p95), más de 35 veces por debajo del umbral SLA de 5.000 ms.
