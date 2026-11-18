# ADR 0035: Cobro simulado recuperable e idempotente

- Estado: propuesto
- Fecha: 2026-11-18
- Participantes: Joel

## Contexto

WEB-005 necesita demostrar un cobro fallido y un reintento sin integrar una pasarela real. El viaje ya queda finalizado y conserva el importe; hoy el servicio registra directamente un cobro confirmado, no expone el recibo a consulta y no permite reintentar un cobro fallido.

El sistema debe conservar un solo cobro por viaje, usar importes exactos y devolver el mismo resultado cuando se repite una clave de idempotencia. La UI del chofer ya muestra el recibo devuelto al finalizar, por lo que el alcance de este cambio agrega lectura pública del cobro y la experiencia de reintento del pasajero.

## Opciones consideradas

### Opción A: pasarela real de pagos

Ventajas reales:

- Representaría una integración de producción y sus respuestas remotas.
- Podría procesar dinero real.

Desventajas reales:

- Requiere credenciales, cuenta, configuración externa y manejo adicional de fallas.
- El alcance del TP pide simular fallas y reintentos, no cobrar dinero real.

### Opción B: adaptador falso determinista

Ventajas reales:

- Permite repetir la demo sin credenciales ni red.
- Produce una falla inicial reproducible y un segundo intento exitoso.
- Mantiene la dependencia detrás de un puerto del dominio.

Desventajas reales:

- No demuestra procesamiento real, conciliación ni garantías de una pasarela externa.
- La secuencia de respuestas solo representa el escenario controlado de demo.

## Decisión

Usar un puerto de procesamiento de cobro y un adaptador falso determinista en `ms-viajes`. El primer intento por cobro devuelve `FALLIDO`; un reintento posterior puede devolver `CONFIRMADO`. La decisión queda en el adaptador, no en Express ni en el dominio.

El dominio conserva una única fila `cobro` por viaje. El registro incluye importe congelado, estado, cantidad de intentos y fecha de creación. `GET /viajes/:idViaje/cobro` permite consultar el recibo. `POST /viajes/:idViaje/cobro/reintento` exige `Clave-Idempotencia` y solo reintenta cobros fallidos. La misma clave devuelve el mismo resultado; una clave nueva solo puede procesar un cobro fallido y nunca vuelve a cobrar uno confirmado.

Solo el pasajero titular, el chofer asignado o soporte pueden consultar el recibo. Para iniciar un reintento de pago se exige ser el pasajero titular o soporte; el chofer no inicia cobros. El adaptador falso es el único punto que crea el fallo controlado; no se agregan credenciales, servicio externo ni cambio de infraestructura.

## Consecuencias

- El estado del cobro puede ser `PENDIENTE`, `FALLIDO` o `CONFIRMADO`.
- La unicidad por `viaje_id` mantiene un solo registro de cobro aunque se repita la finalización.
- El frontend puede recuperar el recibo después de recargar y permitir reintentos sin duplicar efectos.
- El chofer sigue viendo el resultado en el recibo que devuelve `POST /viajes/:idViaje/finalizacion`.
- La simulación no debe confundirse con una integración de pagos real.

## Qué nos haría cambiar de decisión

Si el sistema necesitara procesar pagos reales, conciliar transferencias o recuperar incertidumbre ante timeouts de un proveedor externo, se debe reemplazar el adaptador falso por una pasarela concreta e incorporar los estados y la auditoría que requiera ese proveedor, manteniendo el puerto y la idempotencia.
