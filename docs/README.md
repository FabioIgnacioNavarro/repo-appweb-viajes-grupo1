# Documentación del proyecto

Esta carpeta reúne el diseño y la evidencia del trabajo práctico. Se completa durante el desarrollo; no es un reemplazo del código ni del README principal.

## Documentos

- [Modelo de dominio](modelo.md): actores, entidades, estados e invariantes.
- [API inicial](api.md): flujos y contrato HTTP preliminar.
- [Alcance mínimo demostrable](alcance-minimo.md): primer recorrido de punta a punta y orden de trabajo.
- [Demo web de recorrido](demo-web.md): mapa, ruta OSRM y simulación local de estados.
- [Glosario](glosario.md): vocabulario oficial del dominio.
- [Contratos compartidos](contratos.md): convenciones de datos y comunicación.
- [Flujo de trabajo](flujo-trabajo.md): reglas para colaborar entre agentes y personas.
- [Backlog](backlog.md): tareas, prioridades y criterios de aceptación.
- [Mediciones](mediciones.md): plan reproducible para la tarea pesada y la concurrencia.
- [Ataque cruzado](ataque.md): plantilla para registrar intentos y hallazgos.
- [Temas especiales de cátedra](temas-catedra.md): justificación de temas elegidos (18, 19, 20), uso documentado de microservicios (Tema 4) y tema descartado (1 - Redis).
- [Demostración de Microservicios (Tema 4)](demo-microservicios.md): arquitectura por servicio, costos frente a un monolito modular y prueba reproducible ante caída controlada.
- [Demostración de Observabilidad](demo-observabilidad.md): guía paso a paso para la demo de trazas distribuidas y errores en Jaeger (Tema 18).
- [Informe técnico](informe.md): arquitectura, decisiones, mediciones registradas, seguridad y limitaciones conocidas.
- [Guion de demostración](guion-demo.md): preparación, tiempos y secuencia para presentar los flujos del proyecto.
- [ADRs](adr/): decisiones técnicas y alternativas descartadas.

## Estado de definición

- Variante obligatoria del grupo: A — precio dinámico por demanda.
- Persistencia: PostgreSQL como fuente de verdad; `ms-viajes` y `ms-tarifas` usan SQL directo y puertos asíncronos.
- Módulos: CommonJS en el backend y ESM empaquetado con Vite en la interfaz web (ADR 0001 y ADR 0055).
- Lenguaje: TypeScript.
- Tiempo real: WebSockets autenticados en `ms-viajes`, con eventos por usuario y recuperación del estado mediante HTTP (ADR 0042).
- Búsqueda geográfica: prefiltrado en PostgreSQL y distancia Haversine para la escala de 500 choferes medida (ADR 0041).
- Precio dinámico: regla configurable y versionada, vigencia de 3 minutos, lluvia de Open-Meteo y factores auditables (ADR 0008 y ADR 0021).

## Criterio de avance

Cada funcionalidad debe poder relacionarse con una regla del dominio, un endpoint o caso de uso, una prueba y, cuando corresponda, una decisión documentada.
