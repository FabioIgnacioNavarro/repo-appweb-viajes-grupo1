# ADR 0020: Ejecutar `ms-flota` en Node.js 22 y levantar PostgreSQL con Docker Compose

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Grupo 1 — pendiente de completar

## Contexto

La cátedra exige Node.js 22, Express, Docker Compose y una base relacional reproducible. `ms-flota` necesita PostgreSQL como fuente persistente y no debe depender de secretos reales ni de Redis para funcionar.

## Opciones consideradas

### Dockerfile multi-etapa y PostgreSQL en Compose

Ventajas: imagen de producción pequeña, compilación reproducible y base disponible con un único comando.

Desventajas: requiere cuidar el orden de inicialización y el volumen de datos local.

### Ejecutar Node y PostgreSQL directamente en la máquina

Ventajas: menos archivos de contenedor y arranque local directo.

Desventajas: depende de versiones y permisos de cada máquina; contradice la reproducibilidad pedida.

### Agregar Redis desde el inicio

Ventajas: podría servir para cache, expiraciones o coordinación.

Desventajas: no es obligatorio, no reemplaza PostgreSQL y agrega complejidad sin un caso medido en este vertical.

## Decisión

Se elige un Dockerfile multi-etapa para `ms-flota` y un servicio PostgreSQL 16 en Docker Compose. La configuración usa `.env.example`; no se versionan secretos. Redis no se incorpora.

## Consecuencias

El esquema inicial de `ms-flota` se carga desde `src/ms-flota/schema.sql`. La contraseña del Compose es de desarrollo local y no debe reutilizarse fuera de ese entorno. Antes de entregar se deberá probar el arranque desde un clon limpio.

## Qué nos haría cambiar de decisión

Una exigencia de la cátedra sobre versiones de imagen, una necesidad de separar bases por servicio o una medición que muestre que el esquema de inicialización no es suficiente para migraciones posteriores.
