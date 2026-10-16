# ADR 0003: Separar autenticación de autorización por recurso

- Estado: propuesto
- Fecha: 2026-09-23
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino, Navarro Fabio

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

Se propone validar JWT emitidos por un proveedor externo en cada servicio y aplicar la autorización por recurso dentro de los casos de uso, con pruebas explícitas de acceso permitido y denegado. El login y la emisión del token quedan fuera del repositorio. La validación entra por un puerto para poder usar un adaptador falso en los tests mientras la cátedra confirma emisor, audiencia, algoritmo y claims.

## Consecuencias

Los casos de uso recibirán un actor autenticado y deberán verificar pertenencia, rol y estado antes de devolver o modificar datos. Una caída o respuesta inválida del proveedor se trata como autenticación fallida.

## Qué nos haría cambiar de decisión

Requisitos de revocación inmediata o manejo de sesiones que hagan más segura y simple una sesión persistida.
