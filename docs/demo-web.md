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

### Reglas de Estilo Responsive con Tailwind CSS y Sistema de Diseño (`WEB-003`)
- **Documentación de diseño:** El sistema visual completo está formalizado en [DESIGN.md](../DESIGN.md) y [PRODUCT.md](../PRODUCT.md).
- **Estilos base (`web/src/nucleo/estilos/base.css`):** Define variables CSS de tokens, foco visible global (`:focus-visible`), `overflow-x: clip` contra desbordes horizontales, soporte `@media (prefers-reduced-motion: reduce)`, `.numeros-tabulares` (`tabular-nums`) y objetivos táctiles `.objetivo-tactil` (mínimo `44px`).
- **Mobile-First:** Toda pantalla debe verse correctamente sin scroll horizontal en **360 px** (móvil), **768 px** (tablet) y **1024 px** (escritorio).
- **Accesibilidad:** Un único `<header>` (banner en `Shell.tsx`) y un único `<main id="contenido-principal">` con enlace `"Saltar al contenido principal"`, etiquetas `<label htmlFor>` asociadas en todos los controles, `aria-live` en estados asíncronos y contraste WCAG AA (`>= 4.5:1`).

### Catálogo de Componentes Reutilizables (`@/componentes/comunes`)

Todos los flujos pueden importar los componentes compartidos desde `web/src/componentes/comunes/index.ts`:

```tsx
import {
  Boton,
  Tarjeta,
  TablaResponsiva,
  CampoTexto,
  CampoSelect,
  Toast,
  Modal,
  ContadorRegresivo,
  InsigniaEstadoViaje,
  EstadoConsulta,
} from "@/componentes/comunes";
import { MapaLeaflet } from "@/componentes/mapa/MapaLeaflet";
```

| Componente | Propósito | Estados y Accesibilidad |
|---|---|---|
| `Boton` | Acción primaria, secundaria, por rol (`pasajero`, `chofer`), `peligro` o `fantasma` | Soporta `cargando` (`aria-busy`), altura mínima táctil de 44px en tamaño `md` y foco visible |
| `Tarjeta` | Panel con título, subtítulo, acción opcional y variantes (`neutra`, `alerta`, `exito`, `error`) | Semántica `<section>`, bordes planos 1px sin tarjetas anidadas |
| `TablaResponsiva` | Muestra `<table>` semántica desde `768px` (`md:`) y tarjetas apiladas en móvil (`< 768px`) | Integra `EstadoConsulta`: carga (`role="status"`), vacío y error con botón reintentar (`role="alert"`) |
| `CampoTexto` / `CampoSelect` | Entradas de formulario tipadas y consistentes | Asocian `<label htmlFor>`, `aria-invalid` y `aria-describedby` para ayuda/error |
| `Toast` | Avisos efímeros con autocierre configurable | `role="status"` / `role="alert"` y botón accesible de cierre |
| `Modal` | Confirmaciones o detalle de auditoría | `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, cierre con tecla `Escape` |
| `ContadorRegresivo` | Cuenta atrás `MM:SS` (`tabular-nums`) desde una fecha ISO (`expiraEnIso`) | Aviso visual al cruzar umbral de 30s, evento `alVencer` y `aria-live="polite"` |
| `InsigniaEstadoViaje` | Etiqueta semántica uniforme para los 9 estados del dominio de viajes | Colores de alto contraste por estado (`solicitado` → `finalizado` / cancelados) |
| `EstadoConsulta` | Wrapper estándar de carga, vacío y error recuperable | Evita duplicar spinners o banners ad-hoc en cada vista |
| `MapaLeaflet` | Mapa interactivo con mosaicos de OpenStreetMap (`leaflet`) | Renderiza origen, destino, posición de chofer y polilínea OSRM sin desbordes |

> **Nota sobre librerías externas (`leaflet`):** Se incorpora `leaflet` (ya definida como stack cartográfico desde el ADR 0015 / ADR 0052) como dependencia empaquetada con Vite en lugar del CDN externo de la demo legacy. **Garantiza** el renderizado de mosaicos OpenStreetMap, marcadores vectoriales y polilíneas geográficas; **no calcula rutas ni geocodifica en el cliente** (toda cotización, distancia y polilínea proviene de `ms-tarifas` / OSRM y requiere conexión a `tile.openstreetmap.org` para descargar teselas).

---

## 3. Comandos de Ejecución y Compilación

- **Servidor unificado en Docker Compose (Producción / Gateway):**
  ```powershell
  docker compose up --build -d
  ```
  Nginx compila y entrega la SPA desde `http://localhost:8080/` bajo el mismo origen que la API (sin CORS), con fallback SPA a `index.html`, cabeceras de seguridad básicas (`X-Content-Type-Options`, `Referrer-Policy`) y proxy WebSocket en `/tiempo-real` y `/ws`.

- **Servidor de desarrollo frontend (con recarga en vivo):**
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
