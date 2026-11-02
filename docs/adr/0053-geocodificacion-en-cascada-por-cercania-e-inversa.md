# ADR 0053: Geocodificación en cascada por cercanía y geocodificación inversa

- Estado: aceptado
- Fecha: 2026-11-02
- Participantes: Grupo 1 — Flujo C (Navarro Fabio Ignacio)

## Contexto

Al buscar lugares o calles comunes (por ejemplo *"Av. 9 de Julio"*, *"San Martín"*, *" Sarmiento"* o *"Hospital Perrando"*), una consulta plana a nivel nacional o global suele devolver coincidencias en ciudades de mayor densidad poblacional como Buenos Aires, Córdoba o Madrid antes que en la zona operativa del pasajero. Asimismo, cuando el usuario ajusta manualmente su ubicación arrastrando el pin en el mapa interactivo, necesita confirmación visual del nombre de la calle o lugar al que corresponde esa coordenada.

Se requiere:
1. Priorizar automáticamente las búsquedas de texto según la ubicación inicial del usuario en tres anillos concéntricos configurables:
   - **Nivel 1 (Local — Gran Resistencia):** radio predeterminado de 25 km alrededor del punto de referencia del usuario.
   - **Nivel 2 (Regional — Interior del Chaco y Corrientes):** radio predeterminado de 250 km alrededor del punto de referencia.
   - **Nivel 3 (Nacional — Argentina):** búsqueda general restringida a la República Argentina (`countrycodes=ar` / `region=ar`).
2. Resolver la dirección textual aproximada al arrastrar o fijar un pin en el mapa (geocodificación inversa).

## Opciones consideradas

### Opción A: Consulta única nacional sin restricción geográfica escalonada

Ventajas reales:
- Consume una sola petición HTTP por búsqueda en todos los casos.

Desventajas reales:
- Calles presentes en casi todas las localidades argentinas (como *San Martín*, *Belgrano* o *9 de Julio*) se resuelven sistemáticamente en CABA o grandes capitales si el usuario no escribe explícitamente *", Resistencia, Chaco"*.

### Opción B: Restricción fija y exclusiva al Gran Resistencia

Ventajas reales:
- Evita resultados fuera del área metropolitana.

Desventajas reales:
- Impide cotizar o simular viajes hacia localidades cercanas como Corrientes Capital, Barranqueras, Fontana, Puerto Tirol, Presidencia Roque Sáenz Peña o el resto del país.
- Si el usuario parte desde otra ciudad, el sistema queda rígidamente atado a coordenadas fijas de Resistencia.

### Opción C: Búsqueda en cascada de 3 niveles centrada en la ubicación del usuario y geocodificación inversa en el puerto `Geocodificador`

Ventajas reales:
- **Prioridad geográfica natural:** Si la calle o lugar existe en el radio local del usuario (25 km), se selecciona de inmediato sin ambigüedad; si el usuario escribe una localidad o punto regional (ej. *"Costanera Corrientes"* o *"Sáenz Peña"*), el segundo anillo (250 km) lo captura; si busca una ciudad más lejana de Argentina, el tercer nivel lo resuelve.
- **Dinamismo:** El centro de los cuadros delimitadores (*bounding boxes*) se calcula a partir de la ubicación de origen del usuario (con centro por defecto en Plaza 25 de Mayo, Resistencia `[-27.451, -58.986]` cuando no se indica otro).
- **Geocodificación inversa integrada:** El puerto `Geocodificador` incorpora `geocodificarInversa(coordenada)` implementado en `GeocodificadorNominatim` (`/reverse`), `GeocodificadorGoogle` (`latlng`) y `GeocodificadorFalso` (búsqueda por cercanía a semillas conocidas).
- **Mitigación de cuota y latencia:** Se incorpora caché en memoria por clave normalizada en los adaptadores HTTP para evitar consultas repetidas y respetar la política de 1 petición/segundo de Nominatim.

Desventajas reales:
- Una dirección situada fuera del Gran Resistencia puede requerir 2 o 3 llamadas secuenciales en la primera consulta no cacheada.

## Decisión

Se adopta la **Opción C**.

1. En `src/ms-tarifas/dominio.ts` se incorporan las funciones puras `calcularCuadroDelimitador(centro, radioKm)`, `estaDentroDeCuadro(coordenada, cuadro)` y `construirNivelesCascada(centro, radioNivel1Km, radioNivel2Km, codigoPais)` junto con la ampliación del puerto `Geocodificador`.
2. Los radios de búsqueda son configurables por entorno mediante `GEO_RADIO_NIVEL1_KM` (por defecto `25`) y `GEO_RADIO_NIVEL2_KM` (por defecto `250`).
3. `GeocodificadorNominatim` aplica `viewbox` + `bounded=1` en los niveles 1 y 2, y `countrycodes=ar` en todos los niveles, implementando además `/reverse` para geocodificación inversa y caché en memoria.
4. `GeocodificadorGoogle` aplica `bounds` y verifica pertenencia al cuadro delimitador en los niveles restringidos, implementando además consulta por `latlng` para geocodificación inversa.
5. `GeocodificadorFalso` soporta la misma cascada de cercanía y resolución inversa offline para pruebas automatizadas.
6. En el servidor de demostración (`src/servidor-web.ts`) se expone `POST /demostracion/geocodificar-inversa` y se acepta el parámetro opcional `proximidad` en `POST /demostracion/geocodificar`.

## Consecuencias

- **Positivas:** El usuario puede escribir simplemente *"Sarmiento 800"* o *"Hospital Perrando"* y obtener el punto en el Gran Resistencia, o escribir *"Costanera Corrientes"* y saltar automáticamente al segundo anillo, además de ver el nombre de la calle al soltar el pin en el mapa.
- **Negativas:** Mayor complejidad en el adaptador de geocodificación, cubierta mediante pruebas unitarias deterministas de cada anillo y de la resolución inversa.

## Qué nos haría cambiar de decisión

Si se incorpora autocompletado interactivo mientras el usuario escribe (*typeahead*), se migraría de una cascada secuencial en backend a un motor de sugerencias con sesgo de ubicación como Photon (Komoot) o Google Places Autocomplete.
