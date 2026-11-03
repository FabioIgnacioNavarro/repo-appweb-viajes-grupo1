# ADR 0055: Stack del front-end (React, TypeScript y Tailwind CSS con Vite) y arquitectura modular por roles

- **Estado:** aceptado
- **Fecha:** 2026-11-02
- **Participantes:** Grupo 1 — Flujo C (Fabio Navarro), Flujo A (Joel), Flujo B (Valentino)

## Contexto

Para la entrega y defensa del trabajo práctico se requiere una interfaz web completa, accesible y responsive que permita demostrar en vivo el ciclo de vida del sistema para tres perfiles de usuario distintos:
1. **Pasajero:** estimación de tarifa con variante obligatoria A visible (multiplicador de demanda y lluvia), precio congelado al confirmar, seguimiento en tiempo real y recibo de cobro.
2. **Chofer:** gestión de disponibilidad, recepción de ofertas con cuenta regresiva, aceptación concurrente y avance de estados del viaje.
3. **Operador / Administrador:** listado de viajes, auditoría del multiplicador histórico congelado y edición versionada de las reglas de demanda.

Hasta el momento se contaba con una prueba de concepto en Vanilla JavaScript y CSS sin compilador (`web/index.html` y `web/aplicacion.js`) para validar los endpoints de estimación y mapas. Para el Sprint 1, el equipo necesita construir una aplicación modular donde tres desarrolladores trabajen en paralelo sin colisiones en el código ni en los estilos.

Asimismo, deben respetarse las invariantes de [AGENTS.md](../../AGENTS.md):
- El frontend no debe desplazar ni alterar la arquitectura backend.
- La interfaz nunca decide la autorización: el backend valida token, rol y pertenencia del recurso.
- Toda comunicación pasa por el contrato HTTP consolidado en [docs/api.md](../api.md) y el canal WebSocket documentado en [docs/contratos.md](../contratos.md).

## Opciones consideradas

### Opción A: Mantener Vanilla JavaScript y CSS nativo sin compilador ni bundler

Ventajas reales:
- Cero herramientas de compilación o dependencias en `package.json`.

Desventajas reales:
- Código desestructurado y sin tipado estático: los cambios en contratos o DTOs del backend no se detectan hasta tiempo de ejecución.
- Colisiones en el CSS global: tres desarrolladores editando estilos manuales generan conflictos en Git y roturas visuales accidentales.
- Dificultad para garantizar un diseño verdaderamente responsive en pantallas móviles (360 px), tablets (768 px) y escritorio (1024 px).

### Opción B: Framework SSR fullstack (Next.js / Remix / Nuxt)

Ventajas reales:
- Renderizado del lado del servidor y convenciones de enrutamiento basadas en archivos.

Desventajas reales:
- Introduce un proceso Node.js adicional innecesario en Docker Compose que compite con el API Gateway Nginx y contradice la consigna de microservicios con Express y arquitectura hexagonal.
- Mayor consumo de recursos de memoria y complejidad innecesaria para un frontend que es secundario frente al backend.

### Opción C (Elegida): React 19 + TypeScript + Tailwind CSS v4 empaquetado como SPA estática con Vite

Ventajas reales:
1. **Tipado estricto contra contratos del backend:** TypeScript asegura que las llamadas a la API y los eventos WebSocket coincidan exactamente con las interfaces de `docs/api.md`.
2. **Modularidad estricta para trabajo paralelo:**
   - `web/src/nucleo/`: cliente API uniforme, cliente WebSocket con reconexión, manejo de sesión y router centralizado (a cargo de Fabio).
   - `web/src/vistas/pasajero/`: vista de pasajero, precio dinámico y pagos (a cargo de Joel).
   - `web/src/vistas/chofer/`: vista de chofer, ofertas y avance de viaje (a cargo de Valentino).
   - `web/src/vistas/operador/` y `web/src/vistas/admin/`: paneles de auditoría y reglas (a cargo de Fabio).
3. **Diseño Responsive Mobile-First garantizado:** Tailwind CSS v4 (mediante `@tailwindcss/vite`) provee utilidades estandarizadas (`sm:`, `md:`, `lg:`) que garantizan adaptación visual en 360 px, 768 px y 1024 px sin escribir CSS manual vulnerable a desbordes horizontales.
4. **Despliegue estático nativo en Nginx:** Vite compila en menos de 1 segundo a `dist/web`. El contenedor Nginx existente sirve los archivos estáticos en `http://localhost:8080/` con `try_files $uri $uri/ /index.html` bajo el mismo origen que la API, eliminando configuraciones complejas de CORS.
5. **Seguridad y desacoplamiento:** El token JWT se mantiene en memoria y sesión efímera del navegador; la interfaz nunca almacena credenciales ni toma decisiones de autorización (el backend responde 401/403 ante cualquier manipulación).

## Consecuencias y mitigaciones

- **Positivas:**
  - Código desacoplado y división de trabajo por carpetas con cero colisiones entre los integrantes del grupo.
  - Tipado consistente entre backend y frontend.
  - Servido directamente por Nginx en Docker Compose sin requerir servidores Node.js adicionales.
- **Mitigaciones aplicadas:**
  - Se añade el comando `npm run build:web` al script `npm run build`, asegurando que `npm.cmd test` y el flujo de clon limpio compilen tanto el backend como el frontend en un solo paso.
