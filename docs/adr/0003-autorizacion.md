# ADR 0003: Separar autenticación de autorización por recurso

- Estado: propuesto
- Fecha: 2026-09-23
- Participantes: pendiente de completar

## Contexto

La plataforma maneja datos de viajes y ubicaciones que no deben quedar disponibles por conocer un identificador. El enunciado exige probar que un usuario no puede consultar recursos ajenos.

## Opciones consideradas

### JWT con autorización en casos de uso

Ventajas: no requiere almacenar sesión en cada request y permite identificar al actor en los adaptadores HTTP.

Desventajas: revocación y rotación requieren diseño adicional; validar el token por sí solo no garantiza acceso al recurso.

### Sesiones persistidas

Ventajas: revocación centralizada y control sencillo de sesiones activas.

Desventajas: agrega estado y consultas por request; requiere resolver almacenamiento y expiración de sesiones.

## Decisión

Se propone JWT para autenticación y autorización por recurso dentro de los casos de uso, con pruebas explícitas de acceso permitido y denegado.

## Consecuencias

Los casos de uso recibirán un actor autenticado y deberán verificar pertenencia, rol y estado antes de devolver o modificar datos.

## Qué nos haría cambiar de decisión

Requisitos de revocación inmediata o manejo de sesiones que hagan más segura y simple una sesión persistida.
