# ADR 0025: Validar JWT externos mediante JWKS

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Joel Echeverría (implementación inicial)

## Contexto

Los servicios no emiten tokens ni almacenan credenciales. Deben validar firma, emisor, audiencia,
vencimiento, sujeto y rol. El proveedor real aún no fue confirmado por la cátedra.

## Opciones consideradas

### Compartir un secreto HMAC entre servicios

Ventajas: configuración y verificación simples.

Desventajas: todos los servicios podrían emitir tokens; distribuir un secreto compartido aumenta el
impacto de una filtración.

### Verificar claves públicas mediante JWKS

Ventajas: los servicios solo necesitan claves públicas y permiten rotación del emisor.

Desventajas: hay que configurar URL, emisor, audiencia, algoritmo y claims del proveedor real.

## Decisión

Usar `jose` y JWKS remoto. `JWT_JWKS_URL`, `JWT_EMISOR`, `JWT_AUDIENCIA`, `JWT_ALGORITMO` y
`JWT_CLAIM_ROL` se validan al iniciar los servicios expuestos. El algoritmo permitido es explícito y
nunca acepta `none`. `sub` identifica al usuario; el claim de rol configurado debe coincidir con uno
de los roles del glosario. Los tests inyectan un validador falso. No se implementa login ni se
guardan claves privadas o credenciales reales.

## Consecuencias

Un token inválido se rechaza con `401`; una falla al recuperar una clave JWKS desconocida se trata
como dependencia no disponible. Emisor, audiencia, algoritmo y claims deben confirmarse con el
proveedor antes del despliegue.

## Qué nos haría cambiar de decisión

La documentación oficial del proveedor exige un mecanismo distinto o una política de rotación que
JWKS remoto no pueda cumplir.
