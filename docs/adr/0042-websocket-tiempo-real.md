# ADR 0042: WebSocket autenticado para eventos de viajes en tiempo real

- **Estado:** Aceptado
- **Fecha:** 2026-11-02
- **Participantes:** Flujo B

## Contexto

El Tema 20 requiere notificar ofertas a choferes y cambios de estado y ubicación aproximada al pasajero sin polling constante. Los eventos deben llegar solo al usuario autenticado que participa del recurso. PostgreSQL conserva el estado de verdad; una desconexión no puede perderlo.

## Opciones consideradas

1. **Polling HTTP:** fácil de desplegar y recupera estado, pero genera solicitudes repetidas aun cuando no hay eventos y retrasa la notificación.
2. **Server-Sent Events (SSE):** mantiene una conexión unidireccional eficiente desde servidor a cliente, pero las acciones del cliente seguirían necesitando HTTP separado y el transporte nativo de navegador complica enviar JWT en el handshake.
3. **WebSocket con `ws` en `ms-viajes`:** entrega eventos de forma inmediata por conexiones persistentes bidireccionales y permite compartir un canal autenticado por usuario. Requiere administrar conexiones locales y no distribuye eventos entre réplicas.
4. **Broker compartido (por ejemplo Redis Pub/Sub):** distribuye eventos entre réplicas, pero agrega infraestructura y no aporta persistencia de estado; el proyecto no necesita escalar horizontalmente los sockets para la demo actual.

## Decisión

Se implementa `ws` en el servidor HTTP de `ms-viajes`, en `/tiempo-real`. El handshake valida el token con el mismo puerto JWKS usado por HTTP. Los clientes Node presentan `Authorization: Bearer <JWT>`; navegadores presentan `viajes.v1`, `autenticacion-jwt`, `<JWT>` como subprotocolos. El servidor negocia solo `viajes.v1`; no acepta token en URL ni lo devuelve en el handshake. El adaptador registra cada conexión por `idUsuario`; el dominio y los casos de uso no importan `ws`.

Las ofertas nuevas se envían únicamente al chofer destinatario. Al observar un vencimiento, el servidor guarda `VENCIDA` y publica `OFERTA_VENCIDA`; la marca temporal `expira_en` permite al cliente reflejar el vencimiento exacto sin timer servidor. Al asignar el viaje a otro chofer, las ofertas restantes pasan a `NO_SELECCIONADA`; al cancelar el viaje, pasan a `CANCELADA`. En ambos casos se publica `OFERTA_CANCELADA`. Los cambios de viaje se envían solo al pasajero y chofer vinculados. `ms-flota` reenvía una ubicación nueva al endpoint interno de `ms-viajes` con el JWT del chofer; el viaje valida la relación activa y publica al pasajero coordenadas redondeadas a tres decimales (precisión aproximada de cien metros).

El servidor no almacena ni reproduce eventos. Al conectar o reconectar, el cliente consulta `GET /viajes/:idViaje` o `GET /choferes/yo/ofertas` y reconcilia ese estado persistido con los siguientes eventos. PostgreSQL sigue siendo la fuente de verdad. Las publicaciones son de mejor esfuerzo: una caída del canal no revierte una asignación, actualización ni ubicación persistida.

Nginx conserva una ruta explícita con HTTP/1.1 y encabezados `Upgrade`/`Connection`. El token no se acepta en URL ni se registra.

## Consecuencias

- La entrega inmediata se demuestra en una sola instancia y los errores de autorización ocurren antes de aceptar la conexión.
- Un proceso reiniciado cierra sus conexiones; el cliente vuelve a conectar y recupera el estado con GET.
- La implementación actual no comparte conexiones ni publicaciones entre réplicas. Si se habilita más de una réplica, se requiere afinidad de conexión y un bus de eventos compartido; esa decisión se tomará con una medición que lo justifique.
- La actualización de ubicación interna es de mejor esfuerzo y no modifica el éxito de guardar ubicación en `ms-flota`; si no hay viaje que seguir, `ms-viajes` responde `204` sin registrar una falla.
- La API HTTP de negocio y los vencimientos de ofertas no cambian.

## Condición de revisión

Revisar esta decisión antes de ejecutar varias réplicas de `ms-viajes`, si la aplicación cliente solo permite autenticación WebSocket sin encabezados, o si una medición demuestra pérdida/latencia que requiera persistir o distribuir eventos.
