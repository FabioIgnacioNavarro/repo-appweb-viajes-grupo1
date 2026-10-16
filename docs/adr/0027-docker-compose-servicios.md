# ADR 0027: Levantar la plataforma con Docker Compose

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Joel Echeverría (implementación inicial)

## Contexto

La entrega debe reproducir tres servicios, PostgreSQL y el gateway desde un clon limpio, sin
publicar puertos internos.

## Opciones consideradas

### Ejecutar procesos y base instalados en cada máquina

Ventajas: arranque local rápido una vez instalados.

Desventajas: versiones, variables y orden de inicialización divergen entre integrantes.

### Contenedores con Compose y healthchecks

Ventajas: versiones, red, dependencias y comandos quedan reproducibles.

Desventajas: requiere Docker y datos cartográficos locales si se activa OSRM propio.

## Decisión

Compose define `ms-viajes`, `ms-tarifas`, `ms-flota`, PostgreSQL y Nginx. Solo Nginx publica un
puerto al host. Los servicios esperan al healthcheck de PostgreSQL y exponen `/health` y `/ready`.
El perfil de OSRM propio requiere que el operador suministre datos cartográficos localmente; ninguna
carga usa el servicio público de demostración.

## Consecuencias

`.env.example` contiene valores locales de desarrollo y variables vacías para JWKS, emisor y
audiencia. El volumen PostgreSQL es local y no forma parte de Git.

## Qué nos haría cambiar de decisión

Una plataforma que provea una composición equivalente o una necesidad de despliegue independiente
que justifique otro orquestador.
