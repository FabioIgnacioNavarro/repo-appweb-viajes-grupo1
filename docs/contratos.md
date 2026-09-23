# Contratos compartidos

Estas convenciones permiten que módulos y agentes distintos puedan integrarse sin reinterpretar datos.

## Nombres

- Código y API en inglés técnico consistente; documentación explicativa en español.
- Estados del dominio en mayúsculas; valores JSON en `snake_case`.
- Identificadores con una forma única definida antes de implementar persistencia. No mezclar UUID, enteros y strings arbitrarios sin ADR.
- No introducir sinónimos públicos para los términos del glosario.

## Fechas, dinero y ubicación

- Fechas y horas: ISO 8601 con zona horaria explícita; persistir en UTC.
- Duraciones: milisegundos en contratos internos y segundos o minutos solo cuando el endpoint lo documente.
- Dinero: entero en unidad mínima o decimal exacto; nunca `number` de punto flotante para importes.
- Coordenadas: latitud y longitud en grados decimales, con rango validado y sistema de referencia documentado.
- Distancias: unidad explícita, preferentemente metros.

## Respuesta de error

Toda respuesta de error debe seguir esta forma conceptual:

```json
{
  "error": {
    "code": "TRIP_NOT_ACCESSIBLE",
    "message": "El viaje no está disponible para este usuario.",
    "details": {}
  }
}
```

`code` es estable y apto para clientes; `message` es legible; `details` es opcional y no debe filtrar SQL, stack traces, secretos ni información de otro usuario.

## Autorización

Autenticar no equivale a autorizar. Cada caso de uso debe verificar actor, rol, propiedad o relación con el recurso y estado permitido. Un identificador conocido nunca alcanza por sí solo.

## Idempotencia

Las operaciones con efectos no repetibles deben aceptar `Idempotency-Key`. La clave pertenece a la intención del actor y el resultado guardado debe poder devolverse en un reintento sin repetir el efecto.

## Precio dinámico

- El multiplicador es calculado exclusivamente por el servidor.
- Una estimación debe ser identificable y contener su vigencia o versión de regla.
- La confirmación debe conservar el multiplicador y los datos de demanda usados.
- El precio confirmado es inmutable frente a cambios posteriores de demanda.
- La auditoría debe permitir reconstruir la decisión sin exponer información innecesaria de otros usuarios.

## Cambios de contrato

Un cambio incompatible requiere actualizar `docs/api.md`, agregar o modificar un ADR y registrar pruebas de contrato. Si el cambio afecta otro módulo, debe explicitarse en el pull request.
