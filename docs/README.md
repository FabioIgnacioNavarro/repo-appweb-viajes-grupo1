# Documentación del proyecto

Esta carpeta reúne el diseño y la evidencia del trabajo práctico. Se completa durante el desarrollo; no es un reemplazo del código ni del README principal.

## Documentos

- [Modelo de dominio](modelo.md): actores, entidades, estados e invariantes.
- [API inicial](api.md): flujos y contrato HTTP preliminar.
- [Glosario](glosario.md): vocabulario oficial del dominio.
- [Contratos compartidos](contratos.md): convenciones de datos y comunicación.
- [Flujo de trabajo](flujo-trabajo.md): reglas para colaborar entre agentes y personas.
- [Backlog](backlog.md): tareas, prioridades y criterios de aceptación.
- [Mediciones](mediciones.md): plan reproducible para la tarea pesada y la concurrencia.
- [Ataque cruzado](ataque.md): plantilla para registrar intentos y hallazgos.
- [ADRs](adr/): decisiones técnicas y alternativas descartadas.

## Estado de definición

- Variante obligatoria del grupo: A — precio dinámico por demanda.
- Persistencia: PostgreSQL es la opción preliminar porque el enunciado exige una base relacional.
- Módulos: CommonJS, pendiente de registrar la decisión final.
- Lenguaje: TypeScript.
- Tiempo real: WebSocket o Server-Sent Events, pendiente de comparar y decidir.
- Búsqueda geográfica: pendiente de comparar PostGIS, geohash y estructura en memoria.

## Criterio de avance

Cada funcionalidad debe poder relacionarse con una regla del dominio, un endpoint o caso de uso, una prueba y, cuando corresponda, una decisión documentada.
