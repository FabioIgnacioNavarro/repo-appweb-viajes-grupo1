# Aplicación Web y Demo del Recorrido

Este documento describe la arquitectura, ejecución y estructura de la aplicación web del proyecto, formalizada en el [ADR 0055](adr/0055-stack-del-front.md).

---

## 1. Arquitectura del Front-End (Sprint 1)

Para permitir que los tres integrantes del equipo desarrollen vistas y flujos en paralelo sin colisiones de código ni de estilos, el frontend se estructura como una **Single Page Application (SPA) modular** construida con **React 19, TypeScript y Tailwind CSS v4**, empaquetada con **Vite** y servida estáticamente desde Nginx en el API Gateway (`http://localhost:8080/`).

### Estructura de Carpetas

```text
web/
├── index.html                   # Entry-point HTML de la aplicación
├── tsconfig.json                # Configuración TypeScript del front
├── legacy-demo/                 # Demo original en Vanilla JS (preservada)
└── src/
    ├── main.tsx                 # Montaje de React DOM
    ├── App.tsx                  # Enrutador principal y Shell de layout
    ├── index.css                # Directivas Tailwind CSS v4 (@import "tailwindcss")
    ├── nucleo/                  # Módulos transversales compartidos (Flujo C - Fabio)
    │   ├── tipos.ts             # Tipos y contratos alineados con docs/api.md y docs/contratos.md
    │   ├── sesion.ts            # Almacén de sesión en memoria / sessionStorage y decodificación JWT
    │   ├── api.ts               # Cliente HTTP fetch con Bearer token, Idempotencia y sobre de error
    │   ├── ws.ts                # Cliente WebSocket con reconexión exponencial y eventos tipados
    │   └── router.tsx           # Router por hash con guardas de acceso por rol
    ├── componentes/
    │   └── comunes/
    │       └── Shell.tsx        # Navbar, estado en vivo de WebSocket y control de sesión
    └── vistas/                  # Zonas aisladas asignadas a cada desarrollador
        ├── login/               # Pantalla de acceso con perfiles demo de prueba (Fabio)
        ├── pasajero/            # Estimación, Variante A y Pagos (Joel - WEB-004 y WEB-005)
        ├── chofer/              # Disponibilidad, ofertas y avance de viaje (Valentino - WEB-006 y WEB-007)
        ├── operador/            # Supervisión de viajes y auditoría de precio (Fabio - WEB-008)
        ├── admin/               # Configuración de reglas de demanda por zona (Fabio - WEB-008)
        └── no_autorizado/       # Pantalla 403 Forbidden para accesos denegados
```

---

## 2. Guía para Desarrolladores (Cómo trabajar en cada Flujo)

### Cómo consumir el Núcleo (`web/src/nucleo/`)
Todos los desarrolladores pueden importar utilidades transversales directamente:

```tsx
import { clienteApi } from "@/nucleo/api";
import { clienteTiempoReal } from "@/nucleo/ws";
import { obtenerSesion } from "@/nucleo/sesion";
import { Estimacion, Viaje } from "@/nucleo/tipos";

// 1. Peticiones HTTP autenticadas (inyectan Bearer y traducen errores automáticamente)
const estimacion = await clienteApi.post<Estimacion>("/estimaciones", {
  origen: { latitud: -27.451, longitud: -58.986 },
  destino: { latitud: -27.465, longitud: -58.995 }
});

// 2. Operaciones críticas con idempotencia
const viaje = await clienteApi.post<Viaje>("/viajes", {
  idEstimacion: estimacion.id
}, { claveIdempotencia: "clave-unica-123" });

// 3. Suscripción a eventos en tiempo real (WebSocket - Tema 20)
useEffect(() => {
  const desuscribir = clienteTiempoReal.on("OFERTA_NUEVA", (evento) => {
    console.log("Nueva oferta recibida:", evento.datos);
  });
  return desuscribir;
}, []);
```

### Reglas de Estilo Responsive con Tailwind CSS
- **Mobile-First:** Toda pantalla debe verse correctamente en **360 px** (móvil estándar), **768 px** (tablet) y **1024 px** (escritorio).
- Usar clases utilitarias de Tailwind: `flex flex-col sm:flex-row`, `w-full sm:w-auto`, `p-4 sm:p-6`.

---

## 3. Comandos de Ejecución y Compilación

- **Servidor de desarrollo frontend:**
  ```powershell
  npm.cmd run dev:web
  ```
  Inicia Vite en `http://localhost:5173` con proxy automático hacia el backend y API Gateway.

- **Compilación de producción:**
  ```powershell
  npm.cmd run build:web
  ```
  Genera el bundle optimizado en `dist/web` en menos de 1 segundo.

- **Pruebas unitarias del núcleo web:**
  ```powershell
  npm.cmd test
  ```
  Compila tanto backend como frontend y ejecuta todas las pruebas unitarias (incluyendo `web-nucleo.test.ts`).

---

## 4. Demo histórica en Vanilla JS (Legacy)

La versión anterior construida con Leaflet nativo y Express sin bundler se conserva en la carpeta `web/legacy-demo/` y puede ejecutarse con:
```powershell
npm.cmd run demo:web
```
Disponible en `http://localhost:3000`.
