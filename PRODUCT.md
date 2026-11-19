# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19, TypeScript, Tailwind CSS v4, Vite, OpenStreetMap / OSRM, Nginx, PostgreSQL 16, Node.js 22 LTS

## Users

1. **Pasajero:** Usuario que necesita trasladarse de un origen a un destino en la ciudad. En situación urbana (generalmente desde el móvil en la calle o domicilio), busca saber el precio exacto de antemano, entender por qué existe un recargo por demanda o clima si lo hay, confirmar con precio congelado y seguir al chofer asignado en tiempo real sin sorpresas.
2. **Chofer:** Conductor profesional en viaje o en espera. Opera desde el teléfono montado en el tablero del auto (requiere botones grandes de alta visibilidad, contraste nítido bajo luz diurna y cero elementos distractores). Recibe ofertas de viaje exclusivas de 15 segundos y reporta su ubicación geográfica periódicamente. Invariante: jamás puede tener más de un viaje activo simultáneo.
3. **Operador (Soporte):** Personal de operaciones en terminal de escritorio (1024px+) que supervisa viajes en curso, analiza auditorías de tarifas (desglose de distancia, duración, zona y clima), asiste en cancelaciones y reasigna incidencias.
4. **Administrador:** Responsable técnico y de negocio que audita la plataforma completa, ajusta las reglas de precio dinámico por zona (Variante A) y monitorea el rendimiento bajo carga y concurrencia.

## Product Purpose

Plataforma de viajes urbanos compartidos bajo demanda tipo Uber, diseñada para el trabajo práctico integrador de Programación IV. Su propósito central es garantizar integridad de datos y resistencia bajo alta concurrencia, fallas de dependencias y ataques controlados, demostrando la **Variante Obligatoria A (Precio Dinámico por Demanda y Clima auditable)** con persistencia relacional, arquitectura hexagonal y contratos documentados.

## Positioning

Frente a aplicaciones de transporte tradicionales que operan con algoritmos opacos de "tarifa dinámica", nuestra plataforma se posiciona en la **transparencia total y auditoría**:
- El pasajero visualiza el multiplicador y los factores exactos (demanda de la zona, condición climática) antes de aceptar.
- Al confirmar, el precio se congela de forma atómica e idempotente: no sufre variaciones posteriores durante el trayecto.
- Arquitectura 100% de código abierto sin costos de infraestructura externa ($0 de costo operativo: Leaflet, Nominatim y OSRM en lugar de APIs comerciales de Google Maps).

## Operating Context

- **Chofer y Pasajero:** Contexto móvil (viewports 360px a 480px, conexión móvil variable, interacción táctil rápida, uso al aire libre).
- **Operador y Administrador:** Contexto de oficina/control (viewports 1024px a 1440px+, pantallas densas con tablas, mapas de calor de flota y consolas de auditoría).

## Capabilities and Constraints

- **Arquitectura Hexagonal:** Dominio desacoplado de frameworks, HTTP y drivers de bases de datos.
- **Invariante central de concurrencia:** Un viaje activo tiene exactamente un chofer; un chofer no puede tener más de un viaje activo.
- **Autenticación Externa (RBAC):** Validación de tokens JWT RS256 contra emulador JWKS (o modo falso para tests offline). Los servicios no manejan contraseñas ni login propio.
- **WebSocket con Reconexión:** Notificaciones push de ofertas, ubicación y estados con reconexión exponencial y polling de conciliación vía GET.
- **Idempotencia:** Cabecera `Clave-Idempotencia` obligatoria en confirmaciones para evitar dobles cobros o viajes duplicados por reintentos de red.

## Brand Commitments

- **Identidad:** Sobria, técnica, utilitaria y confiable. Tono de sistema de transporte público/privado de alta ingeniería.
- **Sin clichés estéticos ("Zero AI Slop"):** Prohibido el uso de degradados violeta/fucsia genéricos, fuentes ilegibles, tarjetas anidadas sin sentido o emojis decorativos reemplazando iconografía técnica. Iconos SVG lineales de 1.5px con significado semántico directo.

## Evidence on Hand

- Suite de 115 tests unitarios, de integración y concurrencia pasando al 100% (`npm.cmd test`).
- Simulador local de carga con capacidad de 500 choferes concurrentes (`npm.cmd run test:carga`).
- Contratos consolidados en `docs/api.md` y vocabulario formal en `docs/glosario.md`.
- Arquitectura documentada en 55 ADRs numerados (`docs/adr/`).

## Product Principles

1. **Integridad sobre estética:** Una interfaz hermosa que falle en una condición de carrera o cobre dos veces es un fracaso inaceptable.
2. **Claridad inmediata para el chofer:** Controles táctiles de mínimo 44px, tipografía legible a un metro de distancia y estados binarios inequívocos (Disponible / En viaje / Fuera de servicio).
3. **Auditoría abierta:** Cada cálculo de tarifa almacena su snapshot JSON con la regla, multiplicador y clima en el instante de cotización.
4. **Desempeño sobrio y ligero:** Carga instantánea con Vite, cero librerías pesadas de componentes y soporte de dispositivos de gama baja.

## Accessibility & Inclusion

- Contraste tipográfico estricto WCAG AA (mínimo 4.5:1 para texto normal, 3:1 para texto grande o controles destacados).
- Estados de foco visibles (`focus-visible:ring-2`) para navegación completa por teclado.
- Etiquetas semánticas en todos los campos de formulario y botones de acción rápida.
