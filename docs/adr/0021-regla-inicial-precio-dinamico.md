# ADR 0021: Regla inicial configurable para el precio dinámico

- Estado: aceptado para el prototipo académico
- Fecha: 2026-10-15
- Participantes: Joel Echeverría (implementación inicial)

## Contexto

La variante A exige que lluvia, disponibilidad, demanda zonal y horario afecten el precio en ese
orden, que los valores sean auditables y que el pasajero vea el multiplicador antes de confirmar.
La documentación anterior definía la composición multiplicativa y los límites como pendientes, lo
que impedía construir un endpoint comprobable.

## Opciones consideradas

### Multiplicadores fijos en código

Ventajas: implementación pequeña y valores reproducibles.

Desventajas: cambiar una política exige desplegar; no cumple la necesidad de una regla configurable.

### Regla versionada en PostgreSQL y cargada por un puerto

Ventajas: valores editables, auditables y compartidos por las instancias; permite guardar la versión
exacta junto con cada estimación.

Desventajas: requiere validar la configuración al cargarla y definir valores iniciales para el
prototipo.

## Decisión

Se implementa una regla versionada en PostgreSQL. La tarifa base inicial conserva los valores de la
demo: ARS 1000, ARS 600 por km y ARS 120 por minuto. Los factores iniciales, configurables en la
regla activa, son:

| Factor | Condición inicial | Multiplicador |
|---|---|---:|
| Lluvia | Precipitación actual mayor a 0 mm | 1.10; si no llueve, 1.00 |
| Disponibilidad | 0; 1–2; 3–5; 6–11; 12+ choferes cercanos | 1.30; 1.20; 1.10; 1.00; 0.90 |
| Demanda | Solicitudes activas / max(choferes disponibles, 1): <1; 1–<2; 2–<3; 3+ | 1.00; 1.10; 1.20; 1.30 |
| Horario | Madrugada; mañana; siesta; tarde; noche | 1.00; 1.00; 0.95; 1.05; 1.10 |

Los factores se multiplican en el orden acordado y el total se limita a `[0.75, 2.00]`. La tarifa
base se calcula como `1000 + distancia_metros * 600 / 1000 + duracion_segundos * 120 / 60`.
Se usa aritmética entera escalada y se redondea una sola vez al peso más cercano al final. Los
importes son `bigint` en el dominio, `BIGINT` en PostgreSQL y cadenas de dígitos en JSON.

Las franjas usan hora local de la zona: madrugada 00:00–05:59:59, mañana 06:00–11:59:59, siesta
12:00–15:59:59, tarde 16:00–19:59:59 y noche 20:00–23:59:59.

## Consecuencias

Cada estimación conserva conteos, precipitación, fuente y fecha del clima, franja, multiplicadores
individuales, multiplicador final y versión de regla. Estos parámetros son una política inicial para
la demo académica, no una tarifa comercial; deben revisarse con mediciones del grupo.

## Qué nos haría cambiar de decisión

Si las pruebas de sensibilidad muestran saltos o precios que no reflejan la relación entre demanda y
oferta, el grupo ajustará una nueva versión de regla sin alterar estimaciones ya creadas.
