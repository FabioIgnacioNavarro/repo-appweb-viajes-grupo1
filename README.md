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

Para compilar y ejecutar `ms-flota`:

```text
npm run flota
```

El servicio escucha por defecto en `http://localhost:3002`, usa PostgreSQL cuando existe `DATABASE_URL`
y valida JWT externos con JWKS (`JWT_JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE` y `JWT_ROLE_CLAIM`). No
implementa login. Si no se configura `DATABASE_URL`, el proceso usa memoria solo para desarrollo/tests.

Para iniciar PostgreSQL y aplicar el esquema:

```text
docker compose up -d postgres
docker compose exec -T postgres psql -U viajes -d viajes < src/ms-flota/schema.sql
npm run flota
```

La conexión desde el host usa el puerto `5434`; dentro del contenedor PostgreSQL sigue usando `5432`.
En PowerShell, si la redirección `<` no está habilitada por la versión instalada, puede aplicarse el
esquema desde Git Bash o ejecutarse el comando equivalente con `Get-Content src/ms-flota/schema.sql |
docker compose exec -T postgres psql -U viajes -d viajes`.
El readiness consulta efectivamente PostgreSQL mediante `SELECT 1`.

Para probar endpoints protegidos sin Firebase, usar un entorno que no sea producción y activar el proveedor
falso con `JWT_MODO=falso`. En PowerShell:

```text
$env:JWT_MODO='falso'; $env:NODE_ENV='development'; npm.cmd run flota
```

Después de compilar, se puede generar un actor de prueba con:

```text
node -e "const {ValidadorJwtFalso}=require('./dist/compartido/jwt-falso'); console.log(new ValidadorJwtFalso().generar({idUsuario:'chofer-1',rol:'CHOFER'}))"
```

El token tiene la forma
`falso.<payload-base64url>`. Acepta `PASAJERO`, `CHOFER`, `SOPORTE` y `ADMINISTRADOR`; no firma tokens y
se rechaza explícitamente cuando `NODE_ENV=production`.

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
