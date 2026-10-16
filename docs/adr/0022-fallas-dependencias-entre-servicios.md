# ADR 0022: Fallar cerrado ante dependencias necesarias para estimar o asignar

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Joel Echeverría (implementación inicial)

## Contexto

Una estimación auditable necesita ruta, disponibilidad, demanda, regla vigente y un dato de lluvia
fresco. La búsqueda de flota necesita conocer si un chofer ya tiene un viaje activo. Un valor
sustituto podría producir un precio o una asignación incorrectos.

## Opciones consideradas

### Usar el último valor o un valor neutro ante cualquier caída

Ventajas: conserva disponibilidad del servicio y reduce errores visibles.

Desventajas: puede subestimar el precio, ocultar datos vencidos o devolver choferes ocupados.

### Rechazar la operación que no puede comprobarse

Ventajas: preserva invariantes y hace observable la dependencia fallida.

Desventajas: reduce disponibilidad mientras la dependencia no responde.

## Decisión

La estimación falla con `503 DEPENDENCIA_NO_DISPONIBLE` si no puede obtener ruta, clima fresco,
regla, disponibilidad de flota o demanda. Flota no ofrece candidatos si no puede consultar viajes
activos. Haversine se usa solo cuando se selecciona explícitamente como proveedor offline; nunca se
activa como fallback silencioso. Los reintentos se limitan a lecturas idempotentes.

## Consecuencias

El cliente puede reintentar con la misma clave solo en operaciones idempotentes. Los errores no
incluyen URL interna, token, consulta SQL ni cuerpo del proveedor. `/ready` falla si PostgreSQL no
responde.

## Qué nos haría cambiar de decisión

Una política de tolerancia a fallas que preserve precio, trazabilidad y ocupación sin usar datos
obsoletos.
