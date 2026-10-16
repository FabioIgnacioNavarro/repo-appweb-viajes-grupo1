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
- `OSRM`: servidor configurable por `OSRM_BASE_URL`. La opción recomendada para la entrega y las
  cargas sostenidas es operar una instancia propia con datos cartográficos preparados. El endpoint
  público `router.project-osrm.org` se limita a pruebas manuales de bajo volumen; no se usa para
  benchmarks, pruebas de carga ni producción.
- `HAVERSINE`: fallback local sin rutas reales, útil para tests y desarrollo sin red.

`ms-tarifas` recibe el puerto y solo conoce distancia, duración, proveedor y geometría opcional. La
fórmula de tarifa utiliza la distancia y duración del proveedor seleccionado. Los adaptadores
aplican timeout; OSRM y Google son lecturas y permiten un reintento acotado ante timeout o HTTP 429,
502, 503 y 504. No se reintentan respuestas inválidas ni otros errores 4xx. Los fallos se informan
como dependencia no disponible; nunca se cambia a Haversine en silencio. El fallback offline se
selecciona explícitamente con `RUTA_PROVEEDOR=HAVERSINE`.

## Consecuencias

- El dominio no importa SDKs ni clientes HTTP.
- Las claves permanecen en variables de entorno y `.env` queda ignorado.
- Google ofrece información de tráfico y restricciones más completa, pero requiere clave y costos.
- OSRM propio evita una clave y permite controlar límites y datos, a cambio de operar la preparación
  cartográfica. El servicio público no ofrece garantía y queda excluido de carga.
- PostGIS sigue siendo independiente: sirve para búsquedas y persistencia espacial, no reemplaza el
  cálculo de rutas.

## Revisión

Revisar si la cobertura o latencia de la instancia propia no cumple las mediciones, o si los costos
operativos justifican contratar un proveedor con SLA. Cualquier adaptador alternativo debe respetar
el puerto, timeout, reintento acotado y fallback explícito.
