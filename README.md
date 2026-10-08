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

El diseño y las decisiones de dominio están en [docs/modelo.md](docs/modelo.md) y la estrategia
geográfica pendiente en [docs/adr/0013-busqueda-geografica.md](docs/adr/0013-busqueda-geografica.md).
