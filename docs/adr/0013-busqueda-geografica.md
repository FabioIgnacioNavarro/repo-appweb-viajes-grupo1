# ADR 0013: Definir una estrategia espacial para buscar choferes cercanos

- Estado: propuesto
- Fecha: 2026-10-08
- Participantes: pendiente de completar con los integrantes del grupo

## Contexto

El sistema debe buscar choferes habilitados y disponibles cerca del origen de un viaje. La búsqueda debe soportar actualizaciones frecuentes de ubicación y la carga obligatoria de al menos 500 choferes enviando su posición cada dos segundos.

La consigna no permite traer todos los choferes y calcular distancias en JavaScript sin justificar y medir esa decisión. También exige comparar alternativas y documentar el costo de la solución elegida.

## Opciones consideradas

### Opción A: PostGIS en PostgreSQL

Ventajas:

- Mantiene la búsqueda espacial junto con la persistencia principal.
- Permite usar índices geográficos y consultas por distancia.
- La consistencia entre ubicación persistida y búsqueda es más directa.

Desventajas:

- Agrega una extensión y conocimientos específicos de PostgreSQL.
- Las escrituras frecuentes de ubicación pueden aumentar la carga de la base.
- Requiere diseñar correctamente el índice espacial y medir sus costos.

### Opción B: índice por geohash

Ventajas:

- Permite agrupar posiciones cercanas mediante una clave espacial.
- Puede implementarse sobre una estructura de datos indexada.
- Reduce la cantidad de candidatos antes del cálculo exacto de distancia.

Desventajas:

- Requiere resolver actualización, expiración y consistencia de las claves.
- Las celdas del geohash tienen bordes artificiales y hay que consultar celdas vecinas.
- La precisión y el tamaño de celda deben calibrarse y medirse.

### Opción C: estructura de ubicaciones en memoria

Ventajas:

- Lecturas rápidas para buscar choferes disponibles.
- Desacopla la carga de búsqueda de las consultas históricas.
- Puede ser adecuada para datos de ubicación efímeros.

Desventajas:

- Se pierde o reconstruye la información al reiniciar el proceso.
- Requiere resolver sincronización si existen varias instancias.
- La base y la estructura en memoria pueden quedar desactualizadas.
- Agrega complejidad operativa y no reemplaza la persistencia histórica.

## Decisión

Pendiente de medición comparativa. La decisión final deberá elegir una opción, definir el índice o estructura concreta y demostrar su comportamiento con 500 choferes, incluyendo latencia de solicitud, tiempo hasta asignación, lag del event loop, throughput y memoria.

## Consecuencias

La ubicación actual y el historial seguirán siendo entidades separadas de la estrategia de búsqueda. La solución elegida deberá respetar la autorización de ubicaciones y no podrá exponer posiciones de usuarios no relacionados con el viaje.

## Qué nos haría cambiar de decisión

Se revisará si la solución elegida no sostiene la carga objetivo, supera el tiempo de asignación declarado, provoca un lag inaceptable o no puede mantener consistencia suficiente entre la ubicación actual y los candidatos ofrecidos.
