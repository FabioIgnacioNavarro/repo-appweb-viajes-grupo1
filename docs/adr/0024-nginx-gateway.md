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

## Qué nos haría cambiar de decisión

Si las mediciones muestran que el gateway es cuello de botella o la plataforma provee un gateway
administrado con las mismas políticas.
