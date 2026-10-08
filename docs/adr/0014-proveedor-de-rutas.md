# ADR 0014: Integrar proveedores de rutas mediante un puerto

- Estado: aceptado
- Fecha: 2026-10-08

## Contexto

La demo inicial calculaba la distancia en línea recta con Haversine. Eso no representa el recorrido
real por calles y puede producir un precio incorrecto. Se necesita calcular distancia y duración
por una red vial sin acoplar el dominio a un proveedor externo ni guardar claves en el repositorio.

## Decisión

Se define el puerto `CalculadorRuta` y tres adaptadores seleccionables por configuración:

- `GOOGLE`: Google Routes API `computeRoutes`, con `GOOGLE_MAPS_API_KEY` y facturación/configuración
  habilitadas en el proyecto de Google Cloud.
- `OSRM`: servidor OSRM configurable por `OSRM_BASE_URL`; por defecto se usa el endpoint público
  solo para la demo y cargas pequeñas. Para producción se debe alojar una instancia propia o
  contratar un servicio con límites y soporte explícitos.
- `HAVERSINE`: fallback local sin rutas reales, útil para tests y desarrollo sin red.

El servicio de viaje recibe el puerto y solo conoce distancia, duración, proveedor y polilínea
opcional. La fórmula de tarifa utiliza la distancia y duración del proveedor seleccionado.
Errores de proveedores reales no se ocultan: la demo informa el fallo. El fallback offline se
selecciona explícitamente configurando `RUTA_PROVEEDOR=HAVERSINE`.

## Consecuencias

- El dominio no importa SDKs ni clientes HTTP.
- Las claves permanecen en variables de entorno y `.env` queda ignorado.
- Google ofrece información de tráfico y restricciones más completa, pero requiere clave y costos.
- OSRM evita una clave para la demo, pero el endpoint público no es una dependencia de producción.
- PostGIS sigue siendo independiente: sirve para búsquedas y persistencia espacial, no reemplaza el
  cálculo de rutas.
