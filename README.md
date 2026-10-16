# Plataforma de viajes — demo de terminal

Primer vertical ejecutable del trabajo práctico. Permite simular un viaje completo con pasajero o
chofer, tarifa estimada, actor genérico, inicio, finalización y precio a pagar.

## Ejecutar

Requiere Node.js 22 o superior.

```text
npm install
npm test
npm run demo
```

La demo solicita `PASAJERO` o `CHOFER`, las coordenadas de tu ubicación actual y las coordenadas del
destino. El actor del rol opuesto se completa automáticamente. Los viajes se guardan en memoria
durante la ejecución. La terminal no puede leer GPS automáticamente; para eso hará falta un
adaptador web o móvil con permiso de geolocalización.

Por defecto usa OSRM para calcular rutas reales por calles. Para Google Routes API, copiá `.env.example`
a `.env`, configurá `RUTA_PROVEEDOR=GOOGLE` y agregá una clave de Google Cloud en
`GOOGLE_MAPS_API_KEY`. Para trabajar sin red usá `RUTA_PROVEEDOR=HAVERSINE`.

## Demo web del recorrido

Ejecutá `npm run demo:web` y abrí `http://localhost:3000`. La página deja cargar las coordenadas,
consultar una ruta por calles con OSRM y avanzar manualmente por los estados de una simulación local.
No crea viajes en el backend ni guarda información. Requiere conexión a internet para cargar el mapa
y consultar el servicio público de OSRM.

El diseño y las decisiones de dominio están en [docs/modelo.md](docs/modelo.md) y la estrategia
geográfica pendiente en [docs/adr/0013-busqueda-geografica.md](docs/adr/0013-busqueda-geografica.md).
El alcance y los límites de la página están en [docs/demo-web.md](docs/demo-web.md).

## `ms-flota`

Para compilar y ejecutar el servicio inicial en memoria:

```text
npm run flota
```

El servicio escucha por defecto en `http://localhost:3002` y valida JWT externos con JWKS
(`JWT_JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE` y `JWT_ROLE_CLAIM`). No implementa login. En esta
versión el servidor todavía usa repositorios en memoria; el adaptador PostgreSQL está pendiente de
integración con los puertos asíncronos.

## `ms-tarifas` (prototipo de dominio y HTTP)

Se agregaron cálculo exacto en pesos enteros, snapshots auditables, vigencia de 3 minutos,
Haversine offline, adaptadores OSRM/Google Routes, Open-Meteo y repositorios PostgreSQL. El endpoint
`POST /viajes/estimacion` y la consulta interna `GET /estimaciones/:idEstimacion` requieren JWT.
Para OSRM se debe configurar una instancia propia en `OSRM_BASE_URL`; no se debe usar el servidor
público para pruebas de carga. `RUTA_PROVEEDOR=HAVERSINE` activa modo offline.

Para probar el dominio, ejecutá `npm test`. Para intentar iniciar el proceso de tarifas, completá las
variables de autenticación y base de datos en `.env`, aplicá manualmente
`src/ms-tarifas/schema.sql` y ejecutá `npm run tarifas`. La integración de demanda, disponibilidad,
`ms-viajes`, PostgreSQL de flota, Nginx y Compose de punta a punta todavía no está terminada; el
flujo completo de estimar, confirmar, ofertar, aceptar y cobrar no se puede demostrar aún.

`/health` indica que el proceso vive y `/ready` comprueba la base en `ms-tarifas`. La configuración
de precios semilla y sus límites están descritos en los ADR de `docs/adr/`.

PostgreSQL se puede levantar con:

```text
docker compose up -d postgres
```

La estrategia inicial de cercanía y sus límites están en
[docs/adr/0017-busqueda-flota-inicial.md](docs/adr/0017-busqueda-flota-inicial.md).
