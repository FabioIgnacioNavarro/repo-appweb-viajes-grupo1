# Usamos un proveedor JWT falso solo en desarrollo y tests

**Estado:** aceptado  
**Fecha y participantes:** 2026-10-16 — equipo de desarrollo

## Contexto

Los endpoints protegidos necesitan un actor autenticado para probar `ms-flota` sin depender de Firebase, JWKS externo ni internet. La autenticación real sigue siendo responsabilidad del proveedor JWT externo y no se implementa login en este servicio.

## Opciones consideradas

### Depender siempre de un JWT externo

Ventajas: reproduce la validación de producción.  
Desventajas: hace frágiles los tests, exige red y secretos/configuración externa, y dificulta probar cada rol de forma determinista.

### Proveedor falso explícito para desarrollo y tests

Ventajas: permite generar actores de los cuatro roles sin red ni secretos, y hace los tests repetibles.  
Desventajas: no verifica firmas ni claims completos; si se habilitara accidentalmente en producción sería una vulnerabilidad grave.

## Decisión

Se agrega `ValidadorJwtFalso`, activable únicamente con `JWT_MODO=falso` fuera de producción. Genera tokens marcados con el prefijo `falso.` y valida su estructura y rol. En producción se rechaza explícitamente ese modo; el valor predeterminado usa JWKS RS256.

## Consecuencias

Los tests y las pruebas manuales pueden trabajar offline. El proveedor falso no debe usarse para evaluar la seguridad criptográfica ni reemplaza el validador real; los entornos reales deben configurar `JWT_MODO=real` y JWKS.

## Qué nos haría cambiar de decisión

Revisaríamos esta decisión si el equipo adopta un emulador oficial del proveedor de identidad o si el entorno de integración ofrece tokens efímeros reproducibles sin depender de internet.
