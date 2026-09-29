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
- Precio dinámico: ajustes calculados según demanda y disponibilidad de una zona, lluvia y franja horaria, con evidencia de los datos utilizados.
- Cobro: registro de cobro simulado asociado al viaje, con estado e idempotencia.

## Variante A: precio dinámico por demanda

El precio dinámico considera, en el orden acordado para definirlos: si llueve, choferes disponibles en el momento, demanda de solicitudes en la zona y franja horaria. La tarifa base también usa la distancia y duración estimadas. La regla debe ser configurable y auditable; si la demanda sube, el precio sube y si baja, el precio también baja. El pasajero ve el precio y los factores antes de confirmar. La estimación es válida durante tres minutos. Al confirmar, el precio y los datos de todos los factores utilizados quedan congelados; los cambios posteriores no modifican el precio confirmado.

### Franjas horarias

Se interpreta cada rango en hora local de la zona y se representa como intervalo inclusivo al comienzo y exclusivo al final, evitando huecos y solapamientos. Por ejemplo, madrugada `[00:00, 06:00)` incluye todo instante anterior a las 06:00; en un reloj que muestra segundos, su último segundo es `05:59:59`. A las `06:00:00` ya empieza mañana.

| Franja | Desde (incluido) | Hasta (excluido) |
|---|---:|---:|
| Madrugada | 00:00 | 06:00 |
| Mañana | 06:00 | 12:00 |
| Mediodía-siesta | 12:00 | 16:00 |
| Tarde | 16:00 | 20:00 |
| Noche | 20:00 | 00:00 del día siguiente |

La franja se calcula con la zona horaria configurada para la zona del viaje. Para Chaco puede usarse `America/Argentina/Cordoba`; la configuración debe identificar explícitamente la zona horaria y no depender de la hora local de la máquina donde corre el servidor.

### Fórmula propuesta para discutir

La tarifa base sigue el requisito común: tarifa fija más distancia estimada por precio por kilómetro y duración estimada por precio por minuto. Sobre esa base se aplican los factores en el orden de prioridad elegido por el grupo: lluvia, disponibilidad, demanda y horario.

```text
factor_total = limitar(factor_lluvia * factor_disponibilidad * factor_demanda * factor_horario,
                       factor_total_minimo, factor_total_maximo)
precio_estimado = redondear_a_peso(tarifa_base * factor_total)
```

- **Lluvia:** factor `1` si no llueve; si llueve, un ajuste configurable. Propuesta: que no reduzca el precio.
- **Disponibilidad:** un ajuste por cantidad de choferes disponibles respecto de una referencia configurable de la zona. Fórmula candidata: `limitar(1 + sensibilidad_disponibilidad * (referencia_choferes - choferes_disponibles) / max(referencia_choferes, 1), minimo_disponibilidad, maximo_disponibilidad)`. Menos choferes no debe bajar el precio y más choferes no debe subirlo.
- **Demanda:** `indice_demanda = solicitudes_en_ventana / max(referencia_solicitudes, 1)`. Fórmula candidata: `limitar(1 + sensibilidad_demanda * (indice_demanda - 1), minimo_demanda, maximo_demanda)`. Un índice mayor que uno sube el factor; uno menor que uno lo baja. La ventana y la referencia deben definirse por zona y pueden separarse por franja para comparar períodos similares.
- **Horario:** un ajuste configurable para cada una de las cinco franjas.

Cada factor debe tener límites propios y el producto debe tener un límite total para evitar precios extremos. El orden elegido indica qué factor se acuerda primero; en una fórmula multiplicativa el orden de multiplicación no altera el resultado. No se fijan coeficientes todavía: deben calibrarse con ejemplos y pruebas de monotonicidad. Cada nueva estimación se calcula desde la tarifa base vigente, nunca multiplicando el precio de otra estimación anterior. Estas fórmulas son una propuesta para discutir, no coeficientes aceptados.

### Invariantes de la variante

1. El precio y sus factores siempre provienen del servidor y de una regla vigente.
2. La estimación muestra qué factores y versión de regla se usaron.
3. La confirmación solo acepta una estimación de hasta tres minutos de antigüedad.
4. Una vez confirmado el viaje, el precio aplicado no cambia.
5. Debe poder explicarse posteriormente por qué se aplicó ese precio.

### Carrera específica

Si cambia cualquiera de los factores mientras el pasajero confirma, el precio confirmado debe ser el que el pasajero aceptó en una estimación todavía vigente. La operación debe evitar que se muestre un importe y se cobre otro.

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
7. La misma intención con la misma `Clave-Idempotencia` produce un único efecto.
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
- Fórmula propuesta, límites, redondeo y pesos relativos de demanda, disponibilidad, lluvia y franja horaria.
- Fuente del dato de lluvia, frecuencia de actualización y comportamiento si esa fuente no está disponible.
