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
