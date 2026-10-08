# ADR 0011: Referenciar ubicaciones desde el usuario y limitar los roles habilitados

- Estado: aceptado
- Fecha: 2026-09-30 - 12:20 am
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino, Navarro Fabio

## Contexto

El ADR 0009 decidió mantener la ubicación actual y la histórica separadas de `UsuarioChofer`, pero las modeló solo para choferes y dejó el seguimiento de pasajeros para una decisión futura. El esquema conceptual actual ya identifica las posiciones mediante `usuario_id`.

Se necesita definir si las entidades de ubicación deben depender de `UsuarioChofer` o de la identidad común `Usuario`, y qué roles pueden tener ubicaciones persistidas. La decisión debe permitir que choferes y pasajeros compartan el mismo esquema sin crear ubicaciones para soporte o administración.

## Opciones consideradas

### Opción A: entidades de ubicación específicas por rol

Por ejemplo, `UbicacionActualChofer`, `UbicacionHistoricaChofer` y, si se necesita, tablas equivalentes para pasajeros.

Ventajas:

- Las relaciones expresan directamente el rol y el propósito de cada ubicación.
- Las reglas y consultas de cada rol pueden evolucionar por separado.
- Es posible aplicar estructuras o retenciones distintas por tipo de usuario.

Desventajas:

- Duplica tablas, índices y lógica de escritura y consulta.
- Cada nuevo rol o uso requiere más estructuras y mantenimiento.
- Las consultas comunes de ubicación deben combinar las tablas específicas.

### Opción B: entidades genéricas referenciadas por `usuario.id`

Mantener `ubicacion_actual` y `ubicacion_historica`, ambas con una clave foránea a `usuario.id`, y permitir registros solo para usuarios con rol chofer o pasajero.

Ventajas:

- Reutiliza un único esquema para los dos roles que requieren ubicación.
- La clave foránea apunta a una identidad estable común y no obliga a acoplar ubicación a una tabla de perfil.
- Evita duplicar consultas, índices y procesos de retención por rol.
- La regla de elegibilidad por rol puede aplicarse en el servicio de dominio y autorización.

Desventajas:

- La clave foránea por sí sola no garantiza que el usuario tenga un rol habilitado para ubicación.
- Las operaciones de escritura deben comprobar rol y autorización además de validar la referencia.
- Si choferes y pasajeros necesitan políticas de captura o retención distintas, habrá que distinguirlas explícitamente.

## Decisión

Se elige la opción B. `ubicacion_actual.usuario_id` y `ubicacion_historica.usuario_id` referencian `usuario.id`. Cada usuario puede tener como máximo una fila de ubicación actual; puede tener múltiples registros históricos.

Solo se permite crear o actualizar ubicaciones para usuarios cuyo rol sea `Chofer` o `Pasajero`. Los roles `Soporte` y `Administrador` no reciben ubicación actual ni histórica. Esta restricción se aplica en las operaciones de dominio y autorización; una clave foránea garantiza la existencia del usuario, pero no valida su rol.

La separación entre ubicación actual e histórica y la retención de ubicaciones históricas definida en el ADR 0010 siguen vigentes. Esta decisión amplía el alcance de los usuarios referenciados por el modelo del ADR 0009; en particular, habilita persistir ubicación de pasajeros y reemplaza la limitación allí indicada que reservaba el historial a choferes.

## Consecuencias

- `ubicacion_actual.usuario_id` debe ser único y referenciar `usuario.id`.
- `ubicacion_historica.usuario_id` debe referenciar `usuario.id`; `viaje_id` puede ser nulo cuando el punto no corresponda a un viaje.
- Las escrituras y consultas deben verificar el rol y el permiso sobre el usuario o viaje implicado. No se debe inferir autorización únicamente de conocer un `usuario_id`.
- El sistema no debe recolectar ni conservar ubicaciones de usuarios con rol `Soporte` o `Administrador`.
- La captura, exposición y retención de ubicaciones de pasajeros deben limitarse a los flujos que las necesiten; el ADR 0010 fija 60 días para puntos históricos asociados a viajes.

## Qué nos haría cambiar de decisión

Se revisará si las mediciones o nuevas reglas del dominio requieren políticas de almacenamiento significativamente distintas por rol, si no se puede hacer cumplir de forma fiable la validación de roles en las operaciones de dominio, o si deja de existir la necesidad de compartir el esquema entre choferes y pasajeros.
