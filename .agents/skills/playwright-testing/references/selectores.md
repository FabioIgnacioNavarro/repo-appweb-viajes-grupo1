# Mapa de Selectores y Endpoints para Tests Playwright

## 1. Interfaz Web Demo (`/` servida por `npm run demo:web`)

| Componente | Selector Recomendado | Descripción / Rol |
| :--- | :--- | :--- |
| **Formulario** | `#formulario-ruta` | Formulario de estimación de recorrido |
| **Latitud Origen** | `#latitud-origen` o `page.getByLabel('Punto de partida').getByLabel('Latitud')` | Input numérico latitud origen |
| **Longitud Origen** | `#longitud-origen` o `page.getByLabel('Punto de partida').getByLabel('Longitud')` | Input numérico longitud origen |
| **Latitud Destino** | `#latitud-destino` o `page.getByLabel('Punto de destino').getByLabel('Latitud')` | Input numérico latitud destino |
| **Longitud Destino** | `#longitud-destino` o `page.getByLabel('Punto de destino').getByLabel('Longitud')` | Input numérico longitud destino |
| **Botón Calcular** | `#boton-calcular` o `page.getByRole('button', { name: /mostrar recorrido/i })` | Submit del formulario |
| **Mensaje Status** | `#mensaje-ruta` | Feedback de error o éxito (`.exito` / `.error`) |
| **Precio Estimado** | `#precio-estimado` | Texto con formato de moneda (ej: `$ 1.500`) |
| **Vigencia Tarifa** | `#vigencia-precio` | Contador de tiempo restante de la estimación |
| **Distancia** | `#distancia-ruta` | Distancia calculada en km o metros |
| **Duración** | `#duracion-ruta` | Duración aproximada en min u horas |
| **Botón Avanzar** | `#boton-avanzar` | Botón para cambiar etapa del viaje |
| **Estado Actual** | `#nombre-estado` | Texto: 'Sin iniciar', 'Solicitado', 'Asignado', 'En curso', 'Finalizado' |
| **Botón Reiniciar**| `#boton-reiniciar` o `page.getByRole('button', { name: /reiniciar simulación/i })` | Limpia la ruta y vuelve a estado inicial |

---

## 2. Endpoints Backend para Tests de API (`request` context)

| Endpoint | Método | Autenticación | Header Requerido | Descripción |
| :--- | :---: | :---: | :---: | :--- |
| `/demostracion/estimaciones` | POST | Ninguna | `Content-Type: application/json` | Estimación para la demo web |
| `/viajes/estimacion` | POST | Pasajero | `Authorization: Bearer <jwt>` | Estimación oficial con cálculo de demanda |
| `/viajes` | POST | Pasajero | `Authorization: Bearer <jwt>`, `Clave-Idempotencia: <uuid>` | Confirmación de viaje |
| `/choferes/cercanos` | GET | Pasajero | `Authorization: Bearer <jwt>` | Búsqueda de candidatos |
| `/choferes/yo/ofertas` | GET | Chofer | `Authorization: Bearer <jwt>` | Ofertas recibidas por chofer |
| `/choferes/yo/ofertas/:id/aceptacion`| POST | Chofer | `Authorization: Bearer <jwt>` | Aceptación de oferta de viaje |
