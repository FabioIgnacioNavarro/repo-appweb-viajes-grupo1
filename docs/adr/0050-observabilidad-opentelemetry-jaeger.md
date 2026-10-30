# ADR 0050: Observabilidad distribuida con OpenTelemetry y Jaeger

- Estado: aceptado
- Fecha: 2026-10-30
- Participantes: Grupo 1 — Flujo C (Navarro Fabio Ignacio)

## Contexto

El sistema se divide en tres microservicios (`ms-viajes`, `ms-tarifas`, `ms-flota`) detrás de un gateway Nginx. Una operación de negocio típica (por ejemplo, cotizar o confirmar un viaje) involucra saltos de red entre múltiples procesos independientes: el gateway llama a `ms-viajes`, este consulta candidatos en `ms-flota` y calcula la tarifa con `ms-tarifas`.

Cuando una solicitud falla (por ejemplo, con error `503 DEPENDENCIA_NO_DISPONIBLE`) o experimenta degradación de latencia, resulta inviable correlacionar manualmente qué componente introdujo el retraso o provocó el fallo inspeccionando archivos de logs aislados en cada contenedor.

Asimismo, se debe responder al **Tema 18 de la cátedra** (*Observabilidad: Logs, métricas y trazas distribuidas*), cuya demo práctica exige:
1. Propagar un identificador de traza/correlación a través de al menos dos servicios.
2. Visualizar gráficamente una traza de tiempos distribuidos.
3. Capturar y visualizar un error inducido con su contexto.

## Opciones consideradas

### Opción A: Encabezado artesanal `X-Correlation-Id` con logs estructurados en JSON

Ventajas reales:
- Cero dependencias adicionales en `package.json`.
- Implementación simple mediante middlewares Express y propagación manual en encabezados HTTP.

Desventajas reales:
- No mide tiempos de spans individuales (latencias desglosadas por query SQL, llamada HTTP interna o procesamiento de dominio).
- No provee una interfaz gráfica de usuario para visualizar la cascada temporal de la traza, dificultando la demostración práctica exigida por la cátedra.
- Invención de un protocolo propietario en lugar de adoptar estándares web universales.

### Opción B: Stack ELK / Elastic APM o Datadog

Ventajas reales:
- Solución completa e industrial para trazas, métricas y análisis de logs.

Desventajas reales:
- Exige múltiples contenedores pesados (Elasticsearch, Logstash, Kibana) que consumen más de 2 a 3 GB de memoria RAM, comprometiendo la reproducibilidad del entorno en Docker Compose para un clon limpio.
- Configuración compleja y licencias propietarias o pesadas para el alcance académico del proyecto.

### Opción C: Estándar OpenTelemetry (W3C Trace Context) con Jaeger All-in-One

Ventajas reales:
- OpenTelemetry es el estándar abierto de la industria (Cloud Native Computing Foundation). Utiliza el formato de encabezado estándar W3C `traceparent` (`00-<trace_id>-<span_id>-<flags>`), garantizando interoperabilidad.
- La imagen `jaegertracing/all-in-one` es extremadamente liviana (~50 MB, consumo mínimo de memoria), incluye almacenamiento en memoria para desarrollo/demo y publica una interfaz web lista para usar (`http://localhost:16686`).
- Provee un exportador OTLP HTTP estándar (`http://jaeger:4318/v1/traces`).
- En caso de que el colector de Jaeger esté apagado o no disponible (como en tests unitarios locales), el SDK de OpenTelemetry falla silenciosamente sin degradar ni interrumpir el funcionamiento de los servicios.

Desventajas reales:
- Requiere incorporar las librerías del SDK de OpenTelemetry en `package.json`.
- Requiere agregar el contenedor `jaeger` en `docker-compose.yml`.

## Decisión

Se elige la **Opción C: OpenTelemetry con Jaeger All-in-One**.

1. Se implementa un módulo compartido `src/compartido/observabilidad.ts` que inicializa el SDK de OpenTelemetry para Node.js, configurando:
   - Nombre de servicio configurable vía variable de entorno `OTEL_SERVICE_NAME`.
   - Exportador OTLP HTTP apuntando a `OTEL_EXPORTER_OTLP_ENDPOINT` (por defecto `http://jaeger:4318/v1/traces`).
   - Propagador estándar W3C Trace Context.
2. Cada servicio HTTP (`ms-viajes`, `ms-tarifas`, `ms-flota`) importa e inicializa la observabilidad al arrancar.
3. Se instrumentan las solicitudes entrantes y salientes para capturar el `trace_id` y adjuntarlo a los logs estructurados de la aplicación.
4. Se agrega el servicio `jaeger` a `docker-compose.yml`, exponiendo el puerto `16686` para la interfaz visual y el puerto `4318` para la recepción de trazas OTLP.

## Consecuencias

- **Positivas:** El sistema cuenta con trazabilidad distribuida de nivel productivo. Se cumple en su totalidad la demostración del Tema 18.
- **Negativas:** Incremento en el tamaño del `node_modules` y un contenedor más en el Compose.
- **Riesgo mitigado:** Si Jaeger no está presente, los servicios siguen funcionando con normalidad (resiliencia y fallback seguro).

## Qué nos haría cambiar de decisión

Que la sobrecarga (overhead) de latencia generada por la generación de spans supere el 10% durante las pruebas de carga con 500 choferes, o que la cátedra imponga explícitamente un colector distinto.
