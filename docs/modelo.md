# Modelo de dominio inicial

## Objetivo

La plataforma recibe una solicitud de viaje, estima precio y duración, busca choferes habilitados y cercanos, ofrece el viaje con vencimiento y registra el ciclo hasta finalizarlo o cancelarlo.

## Actores y permisos iniciales

| Actor | Responsabilidad | Alcance inicial |
|---|---|---|
| Pasajero | Solicitar, confirmar, seguir y cancelar sus viajes | Solo sus viajes y su seguimiento |
| Chofer | Gestionar disponibilidad, ubicación, ofertas y estados del viaje | Solo sus ofertas, viajes y ubicación propia |
| Operador | Soporte operativo | Visualiza viajes en curso y puede cancelar con motivo |
| Administrador | Configuración y habilitación | Tarifas, zonas, parámetros y habilitación de choferes |

## Entidades preliminares

- Usuario: identidad, rol, credenciales y estado.
- Chofer: usuario habilitado, vehículo, disponibilidad y ubicación más reciente.
- Vehículo: datos necesarios para mostrar y validar el vehículo del chofer.
- Viaje: pasajero, origen, destino, estimación, tarifa final, estado y chofer asignado.
- Oferta: propuesta de un viaje a un chofer, con vencimiento y resultado.
- Ubicación de viaje: posición histórica del chofer durante el viaje, sujeta a una política de retención.
- Tarifa: parámetros configurables usados por la estimación y el cálculo final.
- Precio dinámico: multiplicador calculado según demanda y disponibilidad de una zona, con evidencia de los datos utilizados.
- Cobro: registro de cobro simulado asociado al viaje, con estado e idempotencia.

## Variante A: precio dinámico por demanda

La demanda se calcula por zona mediante una regla configurable y auditable. El pasajero ve el multiplicador y el precio estimado antes de confirmar. Al confirmar, el multiplicador, el precio y los datos de demanda utilizados quedan congelados en el viaje; cambios posteriores de demanda no modifican el precio confirmado.

### Invariantes de la variante

1. El multiplicador siempre proviene del servidor y de una regla vigente.
2. El precio mostrado antes de confirmar identifica la versión o datos de demanda usados.
3. La confirmación debe verificar que la estimación sigue siendo válida según la política definida.
4. Una vez confirmado el viaje, el multiplicador aplicado no cambia.
5. Debe poder explicarse posteriormente por qué se aplicó ese multiplicador.

### Carrera específica

Si el multiplicador se recalcula mientras el pasajero confirma, el precio confirmado debe ser el que el pasajero aceptó. La operación debe evitar que se muestre un importe y se cobre otro.

## Estados del viaje

```text
SOLICITADO
  ├─> ASIGNADO
  ├─> SIN_CHOFERES_DISPONIBLES
  ├─> CANCELADO_POR_PASAJERO
  └─> CANCELADO_POR_OPERADOR

ASIGNADO ─> CHOFER_EN_CAMINO ─> EN_CURSO ─> FINALIZADO
    ├─> CANCELADO_POR_PASAJERO
    ├─> CANCELADO_POR_CHOFER
    └─> CANCELADO_POR_OPERADOR
```

Las transiciones válidas, los motivos y los efectos secundarios se definirán como reglas del dominio, no como condiciones dispersas en controladores.

## Invariantes críticas

1. Un viaje puede tener como máximo un chofer asignado.
2. Un chofer puede tener como máximo un viaje activo.
3. Un viaje cancelado no puede ser aceptado posteriormente.
4. Una oferta vencida no puede aceptarse.
5. Solo pasajero, chofer asignado u operador autorizado pueden consultar el seguimiento correspondiente.
6. La tarifa se calcula en el servidor; el cliente nunca decide el importe final.
7. La misma intención con la misma `Idempotency-Key` produce un único efecto.
8. Un cobro finalizado no se ejecuta dos veces por reintentos.

## Concurrencia que debe resolverse

- Cincuenta o más choferes aceptan el mismo viaje simultáneamente: exactamente uno gana.
- Pasajero cancela mientras un chofer acepta: debe quedar uno de los dos resultados documentados, sin viaje huérfano ni chofer ocupado incorrectamente.
- Chofer ocupado intenta aceptar otro viaje: debe rechazarse.
- Ubicaciones concurrentes no deben dejar una posición imposible ni bloquear el flujo de asignación.

## Decisiones pendientes

- Mecanismo de bloqueo y orden de bloqueo para viaje y chofer.
- Política exacta de expiración de ofertas.
- Geolocalización y retención de ubicaciones.
- Canal de tiempo real y recuperación tras reconexión.
- Regla exacta, límites y vigencia del multiplicador dinámico.
