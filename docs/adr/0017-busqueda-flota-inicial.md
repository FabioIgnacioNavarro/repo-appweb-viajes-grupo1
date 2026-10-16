# ADR 0017: Filtrar candidatos espacialmente en PostgreSQL y calcular Haversine sobre el subconjunto

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Grupo 1 — pendiente de completar

## Contexto

`ms-flota` debe encontrar choferes habilitados, disponibles, con ubicación reciente y sin viaje activo. La carga objetivo incluye al menos 500 choferes informando ubicación cada dos segundos. No es aceptable traer toda la flota a Node.js y calcular todas las distancias sin una justificación y una medición.

## Opciones consideradas

### PostGIS con índice espacial

Ventajas: consultas geográficas declarativas e índices especializados; buena integración con PostgreSQL.

Desventajas: agrega una extensión y una decisión operativa; las escrituras frecuentes requieren medir el costo del índice.

### Geohash

Ventajas: reduce candidatos mediante celdas y puede implementarse en una columna indexada.

Desventajas: hay que consultar celdas vecinas y resolver bordes, precisión, expiración y actualización de claves.

### Haversine con prefiltrado por cuadro geográfico en SQL

Ventajas: no requiere extensión adicional, es portable y calcula la distancia exacta únicamente sobre ubicaciones dentro de un bounding box; la fórmula es fácil de testear.

Desventajas: el cuadro es una aproximación, especialmente cerca de los polos o con radios grandes; requiere ajustar el índice de latitud/longitud y luego filtrar por distancia exacta.

### Estructura en memoria

Ventajas: lecturas rápidas y menor latencia en una sola instancia.

Desventajas: se pierde al reiniciar, puede divergir de PostgreSQL y complica la coordinación entre réplicas; no reemplaza la fuente persistente.

## Decisión

Para el primer vertical se elige Haversine con prefiltrado espacial en PostgreSQL. La consulta filtra por latitud/longitud y antigüedad en la base, calcula Haversine sobre ese subconjunto y limita el resultado. La implementación en memoria usa la misma fórmula como adaptador falso para tests.

PostGIS y geohash quedan como alternativas para comparar en las mediciones de la tarea pesada; no se agrega una dependencia espacial antes de tener números.

## Consecuencias

Se evita cargar toda la flota en Node.js y se mantiene PostgreSQL como fuente de verdad. La aproximación requiere índices y una medición con 500 choferes. La estrategia no expone coordenadas en la respuesta de candidatos; devuelve identificador, distancia y marca temporal.

## Qué nos haría cambiar de decisión

Si las mediciones muestran que el p95 o el tiempo hasta asignación no cumplen el objetivo declarado, se evaluará PostGIS o geohash. También se revisará si la escala, el radio de búsqueda o la cantidad de instancias vuelven insuficiente el prefiltrado.
