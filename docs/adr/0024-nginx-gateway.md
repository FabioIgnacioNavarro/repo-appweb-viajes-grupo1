# ADR 0024: Enrutar las API de los servicios mediante Nginx

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Joel Echeverría (implementación inicial)

## Contexto

El cliente debe acceder a las rutas públicas sin conocer puertos internos. Las rutas españolas deben
distribuirse entre viajes, tarifas y flota.

## Opciones consideradas

### Publicar cada servicio directamente

Ventajas: menos infraestructura y un salto de red menos.

Desventajas: expone puertos internos, acopla clientes al despliegue y complica TLS y límites comunes.

### Nginx como único gateway

Ventajas: un punto de entrada y políticas de enrutamiento, TLS y límites centralizables.

Desventajas: agrega configuración y un componente que debe supervisarse.

## Decisión

Nginx es el único servicio HTTP publicado por Compose. `/viajes/estimacion` se dirige a `ms-tarifas`,
las demás rutas `/viajes/` a `ms-viajes`, y `/choferes/` a `ms-flota`. Los puertos de aplicación
solo son accesibles dentro de la red de Compose. Nginx no valida identidad: cada servicio valida el
JWT y autorización por recurso.

## Consecuencias

El gateway aplica límites de cuerpo y tiempos de proxy alineados con ADR 0023. Las llamadas
internas usan nombres DNS de Compose y no pasan por el gateway.

## Addendum 2026-11-24: CSP estricta para el frontend

La política de seguridad de contenido se configura en Nginx para que el navegador solo cargue
recursos del mismo origen y los recursos externos que la interfaz necesita explícitamente. Los
scripts y hojas de estilo solo pueden cargarse desde el mismo origen; no se habilitan
`'unsafe-inline'` ni `'unsafe-eval'`. También se bloquean objetos, marcos, bases ajenas y envíos de
formularios a otros orígenes.

El mapa Leaflet todavía genera atributos `style` para sus pines. Se eligió permitir únicamente los
valores exactos mediante hashes SHA-256 en `style-src-attr 'unsafe-hashes'`, en lugar de permitir
cualquier estilo en línea. La prueba `tests/e2e/gateway-config.test.ts` recalcula estos hashes a
partir de `MapaLeaflet.tsx`; si cambia uno de esos estilos, la prueba exige actualizar la política.
Las imágenes externas quedan limitadas a `https://tile.openstreetmap.org`. Se conserva `data:` solo
en `img-src` porque Leaflet usa un GIF transparente mientras prepara los mosaicos; no permite
scripts ni estilos en línea. El cliente de tiempo real solo admite los orígenes locales de WebSocket
del gateway. No se permiten comodines ni el CDN de `unpkg.com`, que la interfaz no utiliza.

Se mantiene el enrutamiento de `/auth/login` y `/auth/` con rate limiting, tiempo de conexión de
1,5 segundos y lectura de 4 segundos. Las rutas `/interno/` y `/estimaciones/` continúan bloqueadas
desde el exterior con `404`.

Referencias: [Content Security Policy Level 3](https://www.w3.org/TR/CSP3/) y
[directiva `style-src-attr`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr).

## Qué nos haría cambiar de decisión

Si las mediciones muestran que el gateway es cuello de botella o la plataforma provee un gateway
administrado con las mismas políticas.
