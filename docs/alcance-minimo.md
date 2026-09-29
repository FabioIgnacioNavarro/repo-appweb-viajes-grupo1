# Alcance mínimo demostrable

## Objetivo

Construir primero un recorrido vertical que permita pedir un viaje con precio dinámico, ofrecerlo a choferes y asignarlo de forma segura. Este alcance sirve para ordenar el comienzo del desarrollo; no reemplaza ninguno de los requisitos comunes ni específicos del enunciado.

## Recorrido principal

1. Un pasajero autenticado pide una estimación para un origen y destino.
2. El servidor calcula precio y duración en pesos argentinos sin centavos, e informa los factores aplicados: disponibilidad de choferes, demanda de la zona, lluvia y franja horaria.
3. El pasajero confirma dentro de los tres minutos. El servidor registra el precio y los datos de todos los factores aceptados; el cliente no decide el multiplicador ni el precio.
4. El sistema busca choferes habilitados, disponibles y cercanos, y crea una oferta con vencimiento.
5. Un chofer acepta la oferta. Si varias aceptaciones compiten, solo una puede asignar el viaje y ocupar al chofer.
6. Pasajero y chofer autorizados consultan el estado actual del viaje.

## Endpoints del recorrido

Se usan los nombres en español definidos en `docs/api.md`:

| Método y ruta | Resultado que tiene que demostrar |
|---|---|
| `POST /viajes/estimacion` | Devuelve precio ARS, factores aplicados, zona y vencimiento a los tres minutos. |
| `POST /viajes` | Confirma una estimación válida con idempotencia y congela el precio aceptado. |
| `GET /choferes/yo/ofertas` | Lista ofertas vigentes del chofer autenticado. |
| `POST /choferes/yo/ofertas/:idOferta/aceptacion` | Acepta una oferta no vencida y asigna el viaje sin duplicar chofer ni viaje activo. |
| `GET /viajes/:idViaje` | Devuelve el estado solo a un actor autorizado para ese viaje. |

Estos endpoints necesitan un soporte mínimo para preparar la demostración: registro e inicio de sesión de pasajero y chofer, habilitación administrativa del chofer, disponibilidad y ubicación del chofer, y carga de parámetros de tarifa y demanda. Las rutas de soporte ya están inventariadas en `docs/api.md`.

## Qué queda para las siguientes etapas

El primer recorrido no se considera el sistema terminado. Después se completa el ciclo de estados, seguimiento en tiempo real, cancelaciones, vencimiento automático y reoferta, cálculo final y cobro simulado, historial y panel del operador. En paralelo se deben cubrir todos los requisitos comunes de seguridad, arquitectura, configuración y operación.

También son entregables obligatorios, aunque se implementen después del primer recorrido: prueba de 50 aceptaciones simultáneas, prueba de cancelación simultánea a aceptación, protección de ubicación por recurso, simulador sostenido de 500 choferes y comparación medida de las versiones ingenua y final.

## Trabajo que hay que hacer

1. Acordar y documentar la fórmula configurable: cómo se combinan lluvia, disponibilidad, demanda y franja horaria; definir límites, redondeo y ejemplos auditables.
2. Usar las franjas ya acordadas en hora local de la zona: madrugada 00:00–06:00, mañana 06:00–12:00, mediodía-siesta 12:00–16:00, tarde 16:00–20:00 y noche 20:00–00:00.
3. Elegir la fuente del dato de lluvia, su frecuencia de actualización y el comportamiento si no está disponible.
4. Aplicar la vigencia decidida de tres minutos y rechazar una confirmación vencida con `409 ESTIMACION_VENCIDA`.
5. Cerrar los estados y transiciones del viaje, incluidos los resultados de aceptación, cancelación y falta de choferes.
6. Completar el contrato de los cinco endpoints del recorrido: pedidos, respuestas, errores, autenticación, autorización e idempotencia.
7. Elegir y documentar cómo se bloquean viaje y chofer durante la asignación, incluido un orden único para evitar interbloqueos.
8. Implementar el recorrido de punta a punta con adaptadores de prueba y persistencia real; agregar pruebas de reglas, permisos, idempotencia y concurrencia.
9. Completar los requisitos restantes del enunciado y preparar una demo reproducible desde un clon limpio.

## Criterio de aceptación del alcance mínimo

Con datos de prueba, un pasajero puede ver una estimación en ARS que considera disponibilidad, demanda, lluvia y franja horaria; confirmar exactamente ese precio dentro de tres minutos; y obtener un viaje ofrecido a choferes. Un chofer habilitado puede aceptar una oferta vigente; solo una aceptación gana; los actores ajenos no pueden consultar el viaje; y los reintentos de confirmación con la misma clave no duplican el viaje. La explicación y los datos necesarios para auditar el precio quedan asociados al viaje.

La vigencia de tres minutos y la moneda ARS ya están decididas. La fórmula exacta, los límites de cada factor, las franjas horarias y la fuente del dato de lluvia deben acordarse antes de implementar la confirmación.
