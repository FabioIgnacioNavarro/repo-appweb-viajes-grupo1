# ADR 0052: Geocodificación abierta con Nominatim (OpenStreetMap) como alternativa sin tarjeta

- Estado: aceptado
- Fecha: 2026-11-02
- Participantes: Grupo 1 — Flujo C (Navarro Fabio Ignacio)

## Contexto

En el [ADR 0051](0051-geocodificacion-y-rutas-google-maps.md) se definió el puerto `Geocodificador` y su adaptador `GeocodificadorGoogle`. Sin embargo, la activación de Google Maps Platform en Google Cloud Console impone una barrera de entrada severa: requiere asociar de forma obligatoria una tarjeta de crédito bancaria internacional para validar la cuenta de facturación. En el contexto de los estudiantes universitarios del equipo y de la evaluación académica por parte de los docentes, esta exigencia bloquea la prueba interactiva con direcciones reales fuera de las semillas estáticas si no se dispone de una tarjeta de crédito habilitada.

Se requiere un adaptador de geocodificación que:
1. Permita resolver direcciones y alturas arbitrarias del mundo real (en particular de Resistencia, Chaco y Argentina) en tiempo de ejecución.
2. Sea 100% gratuito, sin necesidad de tarjeta de crédito, cuenta bancaria ni registro de claves de API privadas.
3. Se integre limpiamente con el puerto `Geocodificador` y coexista con Google Maps y el adaptador falso determinista según las variables de entorno.

## Opciones consideradas

### Opción A: Limitarse exclusivamente a semillas estáticas en memoria cuando no hay clave de Google

Ventajas reales:
- Cero dependencias externas y ejecución 100% predecible.

Desventajas reales:
- Experiencia de usuario empobrecida en la demo: si el usuario o profesor ingresa una dirección real de su domicilio o una calle no precargada (ej. *"Av. San Martín 250"* o *"Marcelo T. de Alvear 300"*), el sistema falla con `DIRECCION_NO_ENCONTRADA`.
- No demuestra la capacidad del backend para resolver direcciones dinámicas reales.

### Opción B: Utilizar servicios comerciales con registro por correo (LocationIQ / Geoapify)

Ventajas reales:
- No piden tarjeta de crédito de entrada para el plan gratuito.
- Buena cobertura geográfica.

Desventajas reales:
- Requieren crear cuentas personales, gestionar tokens en variables de entorno y renovar cuotas que vencen o cambian de condiciones.
- Si un compañero clona el repositorio en una máquina nueva, el sistema no funciona hasta que cree una cuenta en dicho proveedor externo.

### Opción C: Implementar `GeocodificadorNominatim` basado en la API pública de OpenStreetMap

Ventajas reales:
- **Cero fricción y cero tarjetas:** No requiere tarjeta de crédito, ni creación de cuentas en la nube, ni API Keys privadas.
- **Cobertura real comprobada:** OpenStreetMap posee un mapeo comunitario exhaustivo de calles, alturas y puntos de interés de Resistencia y de las principales ciudades argentinas.
- **Coherencia arquitectónica:** El mapa visual de la aplicación web ya utiliza los mosaicos de OpenStreetMap (Leaflet) y el cálculo de trayectos por calles ya soporta OSRM (Open Source Routing Machine), por lo que Nominatim consolida un ecosistema libre y homogéneo.
- **Conmutación transparente:** Si existe `GOOGLE_MAPS_API_KEY`, el sistema puede priorizar Google Maps; si no existe o se configura `GEOCODIFICADOR_PROVEEDOR=NOMINATIM`, conmuta a OpenStreetMap automáticamente sin alterar los casos de uso ni el frontend.

Desventajas reales:
- Política de uso aceptable (*Fair Use Policy*): la instancia pública comunitaria de Nominatim (`nominatim.openstreetmap.org`) requiere un encabezado `User-Agent` descriptivo y limita las peticiones a un máximo de 1 consulta por segundo.
- No es apto para pruebas de carga masiva ni benchmarks (para los cuales se mantiene estrictamente el adaptador `GeocodificadorFalso`).

## Decisión

Se adopta la **Opción C**.

1. Se implementa la clase `GeocodificadorNominatim` en `src/ms-tarifas/proveedores.ts` cumpliendo la interfaz de dominio `Geocodificador`:
   - Realiza peticiones HTTP `GET` a `https://nominatim.openstreetmap.org/search?q=...&format=json&limit=1`.
   - Envía el encabezado `User-Agent: viajes-grupo1-tp/1.0`.
   - Controla timeout de red (2500 ms) y mapea errores estructurados a `ErrorTarifas`.
2. Se actualiza la factoría `crearGeocodificador`:
   - Prioriza `GeocodificadorGoogle` si está presente `GOOGLE_MAPS_API_KEY` o se especifica `GEOCODIFICADOR_PROVEEDOR=GOOGLE`.
   - Utiliza `GeocodificadorFalso` si `PROVEEDORES_MODO=falso`, `GEOCODIFICADOR_PROVEEDOR=FALSO` o durante pruebas automatizadas unitarias/offline.
   - Utiliza `GeocodificadorNominatim` por defecto cuando no se cuenta con clave de Google y se desea resolución en vivo.
3. Se reexporta el adaptador en `src/rutas.ts` para su uso directo en la demo web (`src/servidor-web.ts`).

## Consecuencias

- **Positivas:** El equipo y los docentes pueden probar la aplicación buscando cualquier dirección real sin depender de tarjetas de crédito ni abrir cuentas bancarias. Se preserva la independencia del dominio y la flexibilidad multi-proveedor.
- **Negativas:** La tasa de refresco en la búsqueda manual debe respetar el límite de 1 req/s de la instancia comunitaria.

## Qué nos haría cambiar de decisión

Que la fundación OpenStreetMap bloquee o cierre el acceso a su instancia pública de Nominatim, en cuyo caso se requeriría auto-hostear una instancia local en Docker con datos OSM de Chaco o migrar a Photon/Pelias.
