# ADR 0010: Política de retención de ubicaciones históricas de viajes

- Estado: aceptado
- Fecha: 2026-09-30 - 12:00 am
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino, Navarro Fabio

## Contexto

El sistema consulta la ubicación del chofer cada 5 segundos para mantener actualizada su posición durante el viaje. Persistir cada consulta produciría tres registros por cada intervalo de 15 segundos, aumentando el volumen de datos y la exposición de ubicaciones precisas. Hace falta definir la frecuencia de persistencia y cuánto tiempo se conservará el historial asociado a los viajes.

La decisión cubre las ubicaciones históricas vinculadas a un viaje. La ubicación actual usada para disponibilidad y asignación es un dato distinto y no queda sujeta a este plazo de retención.

## Opciones consideradas

### Opción 1: guardar cada consulta y conservarla indefinidamente

Ventajas:

- Retiene el recorrido con la mayor frecuencia observada.
- Permite reconstruir viajes antiguos con detalle.

Desventajas:

- Multiplica el volumen de escritura y almacenamiento.
- El crecimiento de la base de datos no tiene un límite definido.
- Conserva durante más tiempo datos de ubicación precisos.

### Opción 2: consultar cada 5 segundos, guardar una ubicación cada 15 segundos y borrar el historial al cumplir 60 días

Ventajas:

- Mantiene una ubicación suficientemente frecuente para reconstruir el trayecto reciente.
- Reduce las escrituras históricas a una de cada tres consultas.
- Limita el período de conservación y el crecimiento de los datos históricos.

Desventajas:

- Se pierde detalle espacial entre puntos guardados.
- No se podrá reconstruir el recorrido una vez transcurridos 60 días.
- Requiere un proceso periódico de eliminación y una política de acceso al historial.

### Opción 3: guardar cada 15 segundos y conservar un resumen agregado después de 60 días

Ventajas:

- Conserva estadísticas históricas para análisis de operación.
- Reduce la cantidad de posiciones precisas conservadas a largo plazo.

Desventajas:

- Requiere definir e implementar qué datos se agregan y cómo se disocian.
- El resumen no permite reconstruir el recorrido detallado.
- Agrega un proceso de transformación y mantenimiento que no es necesario para el alcance actual.

## Decisión

Se elige la opción 2:

1. El sistema consulta la ubicación del chofer cada 5 segundos.
2. Para el historial vinculado al viaje, se persiste como máximo una ubicación por cada intervalo de 15 segundos; en el flujo regular esto equivale a guardar una de cada tres consultas.
3. Cada registro histórico se conserva durante 60 días desde `registrado_at`; luego se elimina.
4. La ubicación actual se actualiza según el flujo de consulta y se administra separadamente del historial del viaje.

Los tiempos se calcularán con marcas temporales del servidor en UTC. Si una consulta no obtiene una ubicación válida, no se crea un punto histórico para esa consulta; el siguiente punto válido se guarda cuando corresponda según el intervalo de persistencia. El mecanismo concreto de limpieza podrá ser una tarea periódica, y debe poder ejecutarse nuevamente sin efectos adversos.

## Consecuencias

- `ubicacion_historica` debe incluir `registrado_at` y una referencia al viaje para los puntos del recorrido; la frecuencia de 15 segundos se aplica a esos registros.
- Las consultas del historial deben autorizarse según el viaje y el rol del solicitante, y limitarse a los datos necesarios para ese fin.
- La eliminación debe seleccionar registros con más de 60 días y poder monitorearse. El borrado lógico o físico y la frecuencia exacta de ejecución se concretarán al diseñar persistencia y operación.
- Las pruebas de retención deberán comprobar el límite de 60 días y que el proceso no borre registros recientes.
- Las ubicaciones actuales usadas por asignación no se eliminan por esta política.

## Qué nos haría cambiar de decisión

Se revisará si las mediciones muestran que un intervalo de 15 segundos no sirve para el seguimiento, si el volumen sigue excediendo los límites operativos o si cambian los requisitos de privacidad, auditoría o reclamos.
