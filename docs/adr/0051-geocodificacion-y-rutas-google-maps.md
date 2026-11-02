# ADR 0051: Geocodificación y cálculo de rutas con Google Maps Platform

- Estado: aceptado
- Fecha: 2026-11-01
- Participantes: Grupo 1 — Flujo C (Navarro Fabio Ignacio)

## Contexto

En una plataforma de viajes realista, los pasajeros y choferes interactúan ingresando direcciones textuales (por ejemplo *"Av. 9 de Julio 150, Resistencia"* o *"Aeropuerto de Resistencia"*) y no mediante coordenadas geográficas en grados decimales. 

Para satisfacer esta necesidad sin acoplar el backend a proveedores externos ni exponer credenciales privadas, se requiere:
1. Un puerto de **Geocodificación** que traduzca cadenas de texto a pares `{ latitud, longitud }`.
2. Consolidar el cálculo de rutas mediante **Google Maps Platform (Routes API)** para distancias y duraciones reales por red vial considerando tráfico.
3. Asegurar que los entornos sin conexión, la suite de tests automatizados y el clon limpio reproducible de `AGENTS.md` operen 100% offline utilizando el cálculo esférico **Haversine** y geocodificación fija/falsa sin requerir salida a internet ni API Keys pagas.

## Opciones consideradas

### Opción A: Geocodificación delegada exclusivamente en el frontend

Ventajas reales:
- Menor consumo de recursos de cómputo en los microservicios de backend.

Desventajas reales:
- Exposición de claves privadas de API (`API_KEY`) en el código JavaScript del navegador.
- Impide que clientes puramente HTTP (como aplicaciones móviles, llamadas inter-servicio o requests automatizados) envíen direcciones en texto.
- Viola la regla de que las reglas de negocio y cálculo tarifario residen en el servidor.

### Opción B: Nominatim / OpenStreetMap para Geocodificación y OSRM para Rutas

Ventajas reales:
- Solución comunitaria de código abierto, sin requerimiento de tarjeta de crédito.

Desventajas reales:
- La política de uso aceptable de Nominatim limita drásticamente a 1 petición por segundo y prohíbe pruebas automatizadas o de carga.
- Baja precisión en normalización de alturas y calles de ciudades del interior de Argentina (Resistencia, Corrientes).
- OSRM público (`router.project-osrm.org`) sufre caídas intermitentes y no calcula tiempos con tráfico en vivo.

### Opción C: Google Maps Platform (Geocoding API + Routes API) con fallback offline

Ventajas reales:
- Máxima cobertura, tolerancia a errores ortográficos y resolución precisa de nombres de lugares, puntos de interés y direcciones locales.
- Cálculo de trayectos por red vial considerando condiciones reales de tráfico (`routingPreference: "TRAFFIC_AWARE"`).
- Arquitectura hexagonal: `ms-tarifas` expone los puertos `Geocodificador` y `CalculadorRuta`. Cuando `RUTA_PROVEEDOR=GOOGLE`, se utilizan las APIs de Google vía HTTP backend sin exponer la clave al cliente.
- Con `RUTA_PROVEEDOR=HAVERSINE` o en modo de pruebas (`PROVEEDORES_MODO=falso`), el sistema resuelve direcciones conocidas y calcula distancias esféricas en memoria de forma determinista y sin red.

Desventajas reales:
- Requiere una clave de Google Cloud (`GOOGLE_MAPS_API_KEY`) con las APIs de Geocoding y Routes habilitadas para la demo en vivo.

## Decisión

Se adopta la **Opción C**.
1. Se define el puerto `Geocodificador` en `src/ms-tarifas/dominio.ts`:
   ```ts
   export interface Geocodificador {
     geocodificar(direccion: string): Promise<Coordenada>;
   }
   ```
2. Se implementan los adaptadores en `src/ms-tarifas/proveedores.ts`:
   - `GeocodificadorGoogle`: consume la Google Geocoding API (`https://maps.googleapis.com/maps/api/geocode/json`).
   - `GeocodificadorFalso`: resuelve direcciones de prueba o pares de coordenadas de forma offline determinista.
3. Se actualiza el caso de uso `CrearEstimacion` y los endpoints de `ms-tarifas` y de la demo web para aceptar indistintamente `{ latitud, longitud }` o una dirección en texto (ej. `{ direccion: "..." }`).
4. Se actualiza la demo web (`web/index.html` y `web/aplicacion.js`) para permitir escribir direcciones de texto con autocompletado/búsqueda y visualizarlas sobre el mapa Leaflet.
5. El proveedor por defecto en Compose y tests sigue siendo `HAVERSINE` para asegurar que el clon limpio no dependa de internet ni gaste cuota.

## Consecuencias

- **Positivas:** Experiencia de usuario real en la demo y en la API; arquitectura limpia y testeable; clave resguardada en variables de entorno del servidor.
- **Negativas:** Para probar la resolución en vivo de calles reales fuera de las semillas de prueba, se requiere configurar `GOOGLE_MAPS_API_KEY` en `.env`.

## Qué nos haría cambiar de decisión

Que Google Maps aumente sus costos de forma inviable o que se implemente una instancia propia local de OpenTripPlanner / Valhalla con base de datos espacial de calles locales.
