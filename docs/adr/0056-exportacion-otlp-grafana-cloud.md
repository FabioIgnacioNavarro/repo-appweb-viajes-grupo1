# ADR 0056: Exportación OTLP directa a Grafana Cloud

- Estado: aceptado
- Fecha: 2026-11-24
- Participantes: Grupo 1 — Flujo C (Joel Echeverría)

## Contexto

El ADR 0050 dejó Jaeger como destino local de las trazas. OBS-002 necesita además enviar trazas, métricas HTTP y logs estructurados correlacionados a Grafana Cloud, sin afectar el funcionamiento si el destino remoto no está disponible y sin guardar credenciales en el repositorio.

El proyecto ya usa Docker Compose y admite configuración local mediante `.env`, ignorado por Git. Por una regla explícita del equipo, `.env.example` no se modifica ni se agrega a los cambios de esta tarea.

## Opciones consideradas

### Opción A: Exportar cada señal directamente desde los servicios

Ventajas reales:
- Reutiliza el SDK OpenTelemetry y los exportadores OTLP HTTP ya alineados con Node.js 22.
- Requiere solo un endpoint y encabezados compartidos; cada desarrollador agrega los valores de su stack a su `.env` local.
- Evita sumar otro contenedor obligatorio y permite mantener Jaeger como destino por defecto para el entorno local.
- El SDK exporta en segundo plano con límites de tiempo, por lo que una caída de Grafana Cloud no participa en las respuestas HTTP del negocio.

Desventajas reales:
- Cada proceso administra sus propios lotes y credenciales de exportación.
- Los logs de OpenTelemetry para JavaScript todavía tienen una madurez menor que trazas y métricas; se limita su uso a logs estructurados de bajo volumen y se mantiene la salida JSON estándar a consola.
- No incluye un punto central para filtrar, enriquecer o duplicar telemetría.

### Opción B: Enviar las señales a Grafana Alloy y que Alloy las reenvíe

Ventajas reales:
- Centraliza transporte, reintentos, filtrado, enriquecimiento y enrutamiento a varios destinos.
- Aísla las credenciales remotas de los tres procesos de aplicación.
- Es la arquitectura recomendada para despliegues productivos por Grafana Labs.

Desventajas reales:
- Agrega configuración y un servicio que hay que operar en Docker Compose.
- Para esta demo local requiere definir el receptor OTLP y resolver cómo Alloy toma los logs de los contenedores sin exponer el socket de Docker.
- Introduce más piezas para diagnosticar y mantener en un proyecto académico.

## Decisión

Se elige la **Opción A** para el modo de demostración de OBS-002:

1. Los tres microservicios exportan por OTLP HTTP/protobuf al endpoint configurado mediante `OTEL_EXPORTER_OTLP_ENDPOINT`; los encabezados se leen desde `OTEL_EXPORTER_OTLP_HEADERS`.
2. Los exportadores de métricas y logs quedan apagados en la configuración local predeterminada para que Jaeger siga recibiendo trazas sin recibir señales que no almacena. En modo Grafana se activan con `OTEL_METRICS_EXPORTER=otlp` y `OTEL_LOGS_EXPORTER=otlp`.
3. `.env.example` no se toca. La guía de demo explica cómo crear o editar `.env` local (ignorado por Git) con los valores obtenidos desde el portal de Grafana Cloud. No se guardan tokens, endpoints privados ni valores de autorización en archivos versionados.
4. El middleware registra cantidad y duración HTTP por servicio, método, ruta de Express y estado, evitando etiquetar métricas con IDs, query strings o datos del usuario.
5. Los logs de errores de dependencias se emiten como JSON a consola y como registros OTLP dentro del contexto activo; no incluyen JWT ni encabezados de autenticación.
6. Se usan exportadores por lotes y tiempos máximos configurables. Errores de exportación no bloquean ni cambian las respuestas de negocio.

## Consecuencias

- Jaeger continúa siendo el modo de observación local predeterminado para trazas. Al configurar el endpoint remoto en `.env`, las señales habilitadas se envían a Grafana Cloud.
- Para demostrar las tres señales en Grafana Cloud, el equipo necesita completar los valores de endpoint y autorización en su `.env` local; esos valores no pueden verificarse desde CI ni incluirse en la PR.
- La arquitectura directa es apropiada para desarrollo y una demo académica de bajo volumen. Si el sistema pasa a un entorno productivo, conviene reevaluar Alloy como colector central.
- El estado de madurez del SDK de logs de OpenTelemetry para JavaScript debe revisarse al actualizar dependencias.

## Qué nos haría cambiar de decisión

Que la demo necesite conservar simultáneamente las mismas trazas en Jaeger y Grafana Cloud, que se requiera enriquecer o filtrar telemetría centralmente, o que el volumen/las fallas de exportación justifiquen operar un colector Alloy.
