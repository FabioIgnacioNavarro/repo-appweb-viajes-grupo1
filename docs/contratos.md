# Contratos compartidos

Estas convenciones permiten que módulos y agentes distintos puedan integrarse sin reinterpretar datos.

## Nombres

- Nombres propios de la aplicación —rutas, parámetros, variables y campos JSON— en español. Las rutas usan `kebab-case`, los parámetros `camelCase` y los campos JSON `snake_case`; los métodos y encabezados estándar de HTTP mantienen sus nombres oficiales.
- Estados del dominio en mayúsculas; sus valores JSON usan `snake_case`.
- Identificadores con una forma única definida antes de implementar persistencia. No mezclar UUID, enteros y strings arbitrarios sin ADR.
- No introducir sinónimos públicos para los términos del glosario.

## Fechas, dinero y ubicación

- Fechas y horas: ISO 8601 con zona horaria explícita; persistir en UTC.
- Duraciones: milisegundos en contratos internos y segundos o minutos solo cuando el endpoint lo documente.
- Dinero: moneda del sistema `ARS`, sin centavos; persistir como entero exacto de pesos (por ejemplo, `BIGINT` en PostgreSQL) y exponer en JSON como cadena de dígitos, por ejemplo `"8086"`. No convertir a `number` de JavaScript. Incluir `moneda: "ARS"` en las respuestas con importes.
- Coordenadas: latitud y longitud en grados decimales, con rango validado y sistema de referencia documentado.
- Distancias: unidad explícita, preferentemente metros.

## Respuesta de error

Toda respuesta de error debe seguir esta forma conceptual:

```json
{
  "error": {
    "codigo": "VIAJE_NO_DISPONIBLE",
    "mensaje": "El viaje no está disponible para este usuario.",
    "detalles": {}
  }
}
```

`codigo` es estable y apto para clientes; `mensaje` es legible; `detalles` es opcional y no debe filtrar consultas, trazas internas, secretos ni información de otro usuario.

## Autorización

Autenticar no equivale a autorizar. Cada caso de uso debe verificar actor, rol, propiedad o relación con el recurso y estado permitido. Un identificador conocido nunca alcanza por sí solo.

## Idempotencia

Las operaciones con efectos no repetibles deben aceptar `Clave-Idempotencia`. La clave pertenece a la intención del actor y el resultado guardado debe poder devolverse en un reintento sin repetir el efecto.

## Precio dinámico

- La tarifa base se calcula en el servidor con distancia y duración; disponibilidad, demanda de la zona, lluvia y franja horaria aplican ajustes configurados.
- Si la demanda sube, el componente de demanda eleva el precio; si baja, lo reduce.
- El multiplicador y los ajustes los calcula exclusivamente el servidor.
- Una estimación debe ser identificable, incluir los factores usados y vencer a los tres minutos.
- La confirmación debe conservar el precio visto y los datos de todos los factores usados.
- El precio confirmado es inmutable frente a cambios posteriores de demanda.
- La auditoría debe permitir reconstruir la decisión sin exponer información innecesaria de otros usuarios.

## Cambios de contrato

Un cambio incompatible requiere actualizar `docs/api.md`, agregar o modificar un ADR y registrar pruebas de contrato. Si el cambio afecta otro módulo, debe explicitarse en el pull request.

## Servicios y actor autenticado

La primera separacion de responsabilidades queda definida por el ADR 0016. Los servicios no
implementan login: reciben un JWT en `Authorization: Bearer <token>` y entregan sus claims a los
casos de uso mediante un puerto de validacion. El contrato interno minimo del actor es:

```text
ActorAutenticado {
  id_usuario: string
  rol: PASAJERO | CHOFER | SOPORTE | ADMINISTRADOR
}
```

Mientras no exista una especificacion oficial del emisor, algoritmo y claims, los adaptadores de
prueba pueden construir este actor directamente. Un servicio debe rechazar el pedido si el token
esta vencido, tiene un emisor o audiencia incorrectos, o no permite la operacion solicitada.

Los contratos de servicio se mantienen asi:

- `ms-viajes` consume una estimacion vigente de `ms-tarifas` y candidatos habilitados de `ms-flota`.
- `ms-tarifas` no crea viajes ni asigna choferes.
- `ms-flota` no modifica estados de viajes.
- La confirmacion de viaje conserva `id_estimacion`, `precio_estimado`, `multiplicador_demanda`,
  `factores_precio` y `vigente_hasta` como fotografia auditable.

## Integración inicial de tarifas

`POST /viajes/estimacion` valida JWT y recibe `{ origen: { latitud, longitud }, destino: { latitud,
longitud } }`. `ms-tarifas` resuelve zona, ruta, regla, clima actual, choferes cercanos y solicitudes
activas mediante puertos. La salida incluye importe ARS en string, distancia en metros, duración en
segundos, multiplicador, zona, desglose auditable, versión y vigencia.

Para armar esos factores, `ms-tarifas` reenvía el JWT del pasajero al contrato de cercanía de
`ms-flota` y al contrato interno de demanda de `ms-viajes`. Cada llamada tiene timeout, un reintento
solo para GET transitorios y falla cerrada al superar el presupuesto. Los servicios internos no
publican sus puertos fuera de la red privada de Compose.
