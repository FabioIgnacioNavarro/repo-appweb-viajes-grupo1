# ADR 0054: Emulador de identidad externa OIDC / JWKS y control de acceso RBAC por recurso (Tema 19)

- Estado: aceptado
- Fecha: 2026-11-02
- Participantes: Grupo 1 — Flujo C (Navarro Fabio Ignacio)

## Contexto

En el enunciado del trabajo práctico y en [AGENTS.md](../../AGENTS.md) rige una invariante arquitectónica estricta: **"La autenticación es externa: los servicios validan JWT y no implementan login propio"**. Asimismo, en [docs/temas-catedra.md](../temas-catedra.md) el grupo seleccionó el **Tema Especial 19 (Seguridad: OAuth 2.0 / OIDC, JWT y autorización entre servicios)**.

Para evaluar este tema, la cátedra exige demostrar:
1. Verificación criptográfica asimétrica real mediante **`RS256`** y consulta de claves públicas remotas **`JWKS`** (`/.well-known/jwks.json`).
2. Control de acceso basado en roles (**RBAC**) mediante *claims* del token (`pasajero`, `chofer`, `administrador`, `soporte`).
3. Autorización estricta por recurso (**ownership**): verificar en el caso de uso que el `idUsuario` autenticado sea el titular del viaje, oferta o ubicación requerida.
4. Demostración en vivo de los tres estados HTTP:
   - **200/201 OK:** Token legítimo y actor autorizado sobre el recurso.
   - **401 Unauthorized:** Token ausente, firma adulterada o token expirado (`exp < now`).
   - **403 Forbidden:** Token criptográficamente válido pero con rol no autorizado o sobre un recurso ajeno.

En el [ADR 0029](0029-jwt-falso-desarrollo.md) se definió un validador falso para desarrollo inicial (`JWT_MODO=falso`), dejando asentado explícitamente: *"Revisaríamos esta decisión si el equipo adopta un emulador oficial del proveedor de identidad o si el entorno de integración ofrece tokens efímeros reproducibles sin depender de internet"*.

## Opciones consideradas

### Opción A: Conectarse a Firebase Auth real en Google Cloud

Ventajas reales:
- Utiliza la infraestructura productiva de Google.

Desventajas reales:
- Requiere conexión a internet constante, registro de cuenta en Google Cloud, configuración de Firebase Project ID y credenciales privadas.
- Si un docente o compañero evalúa el proyecto en un clon limpio sin credenciales de Firebase configuradas, el sistema no puede validar tokens reales y falla.

### Opción B: Descargar la imagen pesada de Firebase Tools con Java JRE en Docker Compose

Ventajas reales:
- Emulador oficial provisto por el CLI de Firebase (`firebase emulators:start --only auth`).

Desventajas reales:
- Requiere imágenes Docker de gran tamaño (más de 500 MB), dependencias de Java Runtime Environment (JRE) y configuración de proyectos de Firebase.
- Elevado tiempo de descarga y consumo de memoria innecesario para un propósito que consiste puramente en servir un par de claves RSA vía JWKS y firmar tokens.

### Opción C: Implementar un servicio emulador OIDC / JWKS nativo ultraliviano en Node.js y conectar `ValidadorJwtJwks`

Ventajas reales:
- **Zero-Download y ultra-liviano:** Utiliza la misma imagen `node:22-alpine` ya construida para los microservicios, levantando en menos de un segundo y consumiendo menos de 30 MB de RAM.
- **100% estándar y transparente:**
  - Genera automáticamente un par de claves RSA de 2048 bits al inicio.
  - Expone el endpoint público de claves `GET /.well-known/jwks.json` en formato JWK estándar (`kty: "RSA"`, `alg: "RS256"`, `use: "sig"`).
  - Expone endpoints para emitir credenciales de prueba (`POST /auth/token`, `GET /auth/tokens-demo`): token válido para cada rol, token con firma adulterada y token expirado.
- **Compatibilidad total con los microservicios:** `ms-viajes`, `ms-tarifas` y `ms-flota` ya cuentan con `ValidadorJwtJwks` en `src/compartido/jwt.ts`; solo requieren configurar `JWT_MODO=real` y apuntar `JWT_JWKS_URL` a este servicio.
- **Sin colisiones:** No modifica la lógica interna de los servicios de los otros integrantes ni rompe `JWT_MODO=falso`, preservando los tests existentes.

Desventajas reales:
- Requiere mantener un pequeño archivo de servidor de emulación (`src/emulador-auth/servidor.ts`) dentro del repositorio.

## Decisión

Se adopta la **Opción C**.

1. Se implementa el servicio `auth-emulator` en `src/emulador-auth/`:
   - Gestiona un par de claves RSA con identificador de clave (`kid`) dinámico.
   - Publica `GET /.well-known/jwks.json`.
   - Provee endpoints auxiliares para emitir tokens firmados con claims válidos (`rol`, `sub`, `iss`, `aud`, `exp`), tokens expirados y tokens adulterados.
2. Se incorpora el servicio `auth-emulator` en `docker-compose.yml` en el puerto `9099`, integrado a la red interna de microservicios.
3. Se añaden pruebas unitarias completas para `ValidadorJwtJwks` en `src/compartido/jwt.test.ts` con verificación de firma RS256, expiración, claims anidados, claves desconocidas y rechazo de algoritmo `none`.
4. Se documenta la demostración de los tres escenarios (200, 401, 403) en `requests/seguridad-rbac.http` y en `docs/ataque.md`.

## Consecuencias

- **Positivas:** El proyecto cumple integralmente el Tema Especial 19 de Cátedra de forma demostrable, reproducible en clon limpio y 100% offline sin cuentas en la nube ni tarjetas de crédito.
- **Negativas:** Se agrega un servicio auxiliar en Compose exclusivo para la demostración de identidad.

## Qué nos haría cambiar de decisión

Que la cátedra suministre un servidor central de identidad obligatorio en una IP o dominio universitario unificado para todos los grupos, en cuyo caso bastaría con actualizar las variables de entorno `JWT_JWKS_URL`, `JWT_ISSUER` y `JWT_AUDIENCE`.
