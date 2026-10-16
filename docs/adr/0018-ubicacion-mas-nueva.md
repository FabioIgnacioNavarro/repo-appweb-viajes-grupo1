# ADR 0018: Aceptar solo la ubicación más nueva para actualizar la posición actual

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Grupo 1 — pendiente de completar

## Contexto

Las ubicaciones pueden llegar fuera de orden por retrasos de red, reintentos o concurrencia. Una observación antigua no debe reemplazar la posición actual más reciente.

## Opciones consideradas

### Reemplazar siempre la fila actual

Ventajas: implementación simple y menos comparaciones.

Desventajas: un pedido atrasado puede hacer retroceder la posición; la búsqueda de cercanos puede usar datos incorrectos.

### Actualización condicional por `actualizado_at`

Ventajas: PostgreSQL puede garantizar atómicamente que solo se actualice cuando la marca nueva sea mayor; funciona igual en el adaptador en memoria.

Desventajas: exige que el servidor valide fechas y que todos los productores usen marcas confiables; dos posiciones con la misma marca se resuelven conservando la primera.

## Decisión

Se elige la actualización condicional. `ubicacion_actual` se actualiza únicamente si `EXCLUDED.actualizado_at` es posterior a la marca almacenada. Si la observación es antigua o igual, se devuelve la posición vigente sin sobrescribirla.

## Consecuencias

La posición actual no retrocede por reordenamiento de pedidos. Cada actualización debe conservar UTC y la consulta de candidatos debe descartar ubicaciones demasiado antiguas. El historial, cuando se incorpore a este adaptador, podrá conservar observaciones separadas sin cambiar esta regla.

## Qué nos haría cambiar de decisión

Una fuente de ubicación que no entregue marcas comparables o una política posterior que requiera aceptar correcciones explícitas con un mecanismo de revisión separado.
