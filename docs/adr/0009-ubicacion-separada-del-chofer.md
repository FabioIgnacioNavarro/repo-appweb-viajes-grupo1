# ADR 0009: Mantener la ubicación del chofer separada de `UsuarioChofer`

- Estado: aceptado
- Fecha: 2026-09-30 - 10:30 am
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino, Navarro Fabio

## Contexto

La plataforma necesita recibir y consultar la ubicación actual de los choferes disponibles, además de conservar un historial de ubicaciones para reconstruir recorridos y realizar mediciones de carga.

Se evaluó si la latitud, la longitud y la fecha de actualización debían vivir directamente en `UsuarioChofer` o en una entidad separada. La decisión afecta la normalización del modelo, la escalabilidad de las actualizaciones periódicas, la posibilidad de agregar datos geográficos y la futura integración con un historial de ubicaciones.

La ubicación de un pasajero no se persistirá continuamente como parte de esta decisión. Para el flujo común, su origen y destino se registran en `Viaje`; una necesidad futura de rastrear al pasajero deberá evaluarse en otro ADR por sus implicancias de privacidad.

## Opciones consideradas

### Opción A: guardar la ubicación directamente en `UsuarioChofer`

Ejemplo conceptual:

```text
UsuarioChofer
- usuario_id
- disponible
- latitud_actual
- longitud_actual
- ubicacion_actualizada_at
```

Ventajas:

- Modelo simple y fácil de entender.
- Consulta rápida de la última ubicación, sin un `JOIN` adicional.
- Actualización sencilla cuando el sistema recibe una nueva posición.
- Menor cantidad inicial de tablas y relaciones.

Desventajas:

- Mezcla datos relativamente estables del chofer con datos que cambian frecuentemente.
- No resuelve el historial: requiere otra tabla de todos modos.
- Hace más difícil ampliar la información geográfica con precisión, velocidad, fuente o dispositivo.
- Puede limitar la evolución hacia índices espaciales y estrategias de retención más específicas.

### Opción B: guardar la ubicación actual en una tabla separada

Modelo conceptual:

```text
UsuarioChofer
- usuario_id
- disponible

UbicacionActualChofer
- chofer_id PK/FK
- latitud
- longitud
- actualizado_at
```

Y para el historial:

```text
UbicacionHistoricaChofer
- id
- chofer_id FK
- latitud
- longitud
- registrado_at
- viaje_id nullable
```

Ventajas:

- Mantiene separado el perfil del chofer de sus datos de ubicación cambiantes.
- Permite representar explícitamente una relación uno a uno para la ubicación actual y uno a muchos para el historial.
- Facilita agregar precisión, velocidad, fuente, sistema de referencia u otros metadatos.
- Permite definir políticas de retención y archivado sobre el historial sin modificar `UsuarioChofer`.
- Es más adecuada para evolucionar hacia PostGIS o índices geográficos.
- Hace más clara la autorización sobre quién puede consultar una ubicación.

Desventajas:

- La consulta de la ubicación actual puede requerir un `JOIN` o una consulta adicional.
- La actualización debe mantener correctamente la fila actual y, cuando corresponda, insertar el registro histórico.
- Agrega tablas, claves foráneas y reglas de consistencia.
- Requiere diseñar con cuidado la concurrencia de actualizaciones periódicas.

### Opción C: usar una tabla genérica `Ubicacion` referenciada por `ubicacion_actual_id`

Ventajas:

- Permite reutilizar una estructura para distintos tipos de ubicación.
- La actualización puede crear una nueva observación y cambiar la referencia actual.
- Puede servir si el dominio necesita tratar todas las ubicaciones como recursos iguales.

Desventajas:

- Puede mezclar ubicación actual, origen, destino e historial bajo un concepto demasiado genérico.
- Deja que las observaciones anteriores queden huérfanas si no existe una política explícita.
- Introduce una referencia mutable adicional y mayor complejidad transaccional.
- No expresa tan claramente quién es dueño de la ubicación ni si representa una observación histórica.

## Decisión

Se elige mantener la ubicación separada de `UsuarioChofer`, mediante una entidad para la ubicación actual y otra para el historial de ubicaciones. Esta opción ofrece mejor normalización, escalabilidad y extensibilidad que guardar latitud y longitud directamente en `UsuarioChofer`.

La ubicación actual se modelará como una relación uno a uno con el chofer. El historial se modelará como una relación uno a muchos y podrá asociarse opcionalmente a un viaje. La forma exacta del tipo geográfico, los índices y la política de retención se definirán en las decisiones de persistencia y geolocalización correspondientes.

## Consecuencias

### Positivas

- `UsuarioChofer` conserva únicamente información propia del perfil y operación del chofer.
- El diseño permite recibir ubicaciones periódicas sin hacer crecer la entidad principal.
- Se puede consultar la última posición y conservar el recorrido histórico de forma independiente.
- Se facilita la incorporación futura de PostGIS, índices espaciales y políticas de retención.
- La autorización de ubicación queda explícita: solo el pasajero del viaje actual, el chofer correspondiente y los roles operativos autorizados pueden acceder a ella.

### Negativas

- La lectura de la ubicación actual tiene una relación o consulta adicional.
- La actualización debe garantizar consistencia entre ubicación actual e historial.
- El historial puede crecer rápidamente y deberá medirse, indexarse y conservarse según una política documentada.
- Las actualizaciones concurrentes de ubicación deben evitar que una observación antigua sobrescriba una más nueva.

## Qué nos haría cambiar de decisión

Se revisaría esta decisión si las mediciones demostraran que la tabla separada impone una latencia o una carga incompatible con el objetivo de 500 choferes enviando ubicación cada dos segundos, o si una restricción concreta de la base hiciera imposible mantener la consistencia requerida.

También se revisaría si el dominio dejara de necesitar historial, metadatos geográficos o evolución hacia búsquedas espaciales, y la complejidad adicional dejara de aportar valor demostrado.
