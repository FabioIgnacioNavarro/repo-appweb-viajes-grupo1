# ADR 0001: Usar TypeScript compilado a CommonJS en backend y ESM empaquetado con Vite en frontend

- Estado: aceptado
- Fecha: 2026-11-03 (actualizado y cerrado en Sprint 1)
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino, Navarro Fabio

## Contexto

El proyecto debe ejecutarse sobre Node.js 22 para los microservicios backend y proveer una aplicación web moderna (SPA) para pasajeros, choferes y operadores. La consigna prohíbe mezclar sistemas de módulos de forma caótica o sin justificación arquitectónica.

Durante el inicio del proyecto se planteó la disyuntiva entre CommonJS y ESM:
1. El backend interactúa directamente con APIs del sistema operativo, el ejecutor de pruebas nativo de Node 22 (`node --test`), librerías de infraestructura como `pg`, `express`, `ws`, y el SDK de OpenTelemetry.
2. En el Sprint 1 se adoptó React 19, TypeScript y Tailwind CSS v4 para el frontend ([ADR 0055](0055-stack-del-front.md)), el cual opera de forma óptima en el ecosistema ESM moderno mediante bundlers como Vite.

Era necesario definir y formalizar cómo conviven ambos entornos de manera limpia, sin colisiones de resolución de módulos ni fricción en clon limpio.

## Opciones consideradas

### Opción A: ESM puro de extremo a extremo (Backend y Frontend)

Ventajas:
- Un solo estándar de JavaScript en todo el repositorio (`"type": "module"` en `package.json`).
- Sintaxis `import`/`export` nativa en tiempo de ejecución de Node.js.

Desventajas:
- En Node 22 con TypeScript, ESM puro exige agregar explícitamente extensiones `.js` en todas las importaciones de TypeScript (`import { foo } from "./bar.js"`), lo cual genera confusión e inconsistencias entre desarrolladores.
- Incompatibilidades y fricción con `__dirname`, `__filename`, mocks de tests y ciertas dependencias de instrumentación de OpenTelemetry y Express 5.
- Mayor fragilidad en la ejecución de scripts y herramientas del curso.

### Opción B: CommonJS puro de extremo a extremo (incluyendo el Frontend sin bundler)

Ventajas:
- Configuración idéntica y sin bundler para todo el proyecto.
- Compatibilidad inmediata con cualquier versión de Node.js y paquetes legacy.

Desventajas:
- Impide utilizar frameworks modernos de interfaz como React 19 y Tailwind CSS v4 con Hot Module Replacement (HMR).
- Obliga a mantener código en Vanilla JavaScript sin tipado estático contra contratos (como la demo histórica `web/legacy-demo/`), lo cual dificulta que tres desarrolladores trabajen en paralelo sin colisionar en estilos globales ni DTOs.

### Opción C (Elegida): Aislamiento claro — CommonJS en Backend (Node 22) y ESM en Frontend (Vite)

Se define una separación estricta por capas y ciclo de vida de empaquetado:

1. **Backend y Tests (`src/`, `tests/`):**
   - Configurado con `"type": "commonjs"` en `package.json`.
   - Compilado con `tsconfig.json` (`module: "CommonJS"`, `moduleResolution: "Node"`, `target: "ES2022"`).
   - Los tests unitarios y de integración compilan con `tsconfig.tests.json` y se ejecutan directamente con el test runner nativo de Node 22 (`node --test dist-tests/tests/**/*.test.js`).
   - Los microservicios (`ms-viajes`, `ms-tarifas`, `ms-flota`, `emulador-auth`) corren como procesos Node independientes en CommonJS en desarrollo y dentro de contenedores Docker.

2. **Frontend SPA (`web/`):**
   - Configurado con `web/tsconfig.json` (`module: "ESNext"`, `moduleResolution: "bundler"`, `target: "ES2022"`, `jsx: "react-jsx"`).
   - Empaquetado por Vite ([ADR 0055](0055-stack-del-front.md)) en un bundle estático optimizado con JavaScript ESM estándar y CSS generado en `dist/web/assets/`.
   - Servido en desarrollo por el dev server de Vite en `http://localhost:5173` y en producción como archivos estáticos servidos por Nginx en el gateway `http://localhost:8080/`.

3. **Interoperabilidad limpia de contratos:**
   - No hay mezcla de módulos en tiempo de ejecución: Node.js nunca intenta cargar bundles de Vite, y el navegador nunca intenta ejecutar CommonJS en crudo.
   - Las interfaces y tipos de contratos compartidos (`src/compartido/web-nucleo/tipos.ts`) son definiciones puras de TypeScript que se consumen en ambos mundos en tiempo de compilación y se borran en tiempo de emisión.

## Decisión

Aceptar definitivamente el uso de **CommonJS para el backend de microservicios y tests en Node.js 22**, y **ESM empaquetado mediante Vite para el frontend SPA en React 19**.

La decisión fue validada exitosamente mediante:
- Clon limpio reproducible documentado en `README.md`.
- Compilación dual exitosa: `npm run build:server` (tsc) y `npm run build:web` (vite).
- Suite de 115 tests unitarios e integración pasando al 100% con `npm.cmd test`.
- Suite E2E de Playwright ejecutándose sobre ambos entornos con `npm.cmd run test:pw`.

## Consecuencias

Positivas:
- **Estabilidad backend:** Cero problemas con extensiones `.js` artificiales en TypeScript, soporte completo y estable para `express`, `pg`, `ws`, OpenTelemetry y `node:test`.
- **Agilidad frontend:** Vite ofrece recarga instantánea en caliente (HMR), compilación de React 19 y Tailwind CSS v4 en milisegundos, y empaquetado estático óptimo.
- **Independencia de despliegue:** El frontend estático puede alojarse en cualquier servidor web (Nginx, CDN o S3) sin arrastrar un proceso Node adicional.
- **Trazabilidad estricta:** Cada entorno tiene su propio `tsconfig` específico (`tsconfig.json`, `tsconfig.tests.json`, `web/tsconfig.json`) sin interferencias.

Negativas / Mitigaciones:
- Requiere dos comandos de compilación en `package.json` (`"build": "npm run build:server && npm run build:web"`), mitigado mediante scripts npm unificados.
- El Dockerfile de los microservicios backend debe compilar únicamente `build:server` para evitar dependencias innecesarias del frontend en los contenedores de servicio.

## Qué nos haría cambiar de decisión

- Que Node.js deprecara o eliminara el soporte a CommonJS (inviable en el horizonte previsible de Node 22 LTS).
- Que una dependencia crítica del núcleo backend eliminara el soporte a CommonJS sin alternativa viable.
