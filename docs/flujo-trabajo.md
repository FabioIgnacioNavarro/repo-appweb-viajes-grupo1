# Flujo de trabajo colaborativo

## Antes de implementar

1. Identificar la regla de negocio o requisito que se quiere cubrir.
2. Revisar `AGENTS.md`, `docs/glosario.md`, `docs/modelo.md` y `docs/contratos.md`.
3. Crear o actualizar una entrada del backlog con criterio de aceptación.
4. Registrar un ADR si la tarea implica una decisión técnica relevante.
5. Identificar riesgos de autorización, concurrencia, idempotencia y observabilidad.

## Durante la implementación

- Mantener el dominio independiente de Express, PostgreSQL y servicios externos.
- Colocar las dependencias detrás de puertos y crear dobles de prueba cuando corresponda.
- Actualizar documentación y tests junto con el cambio, no al final del cuatrimestre.
- No cambiar nombres públicos o estados sin revisar los contratos compartidos.
- No agregar una librería para resolver un problema sin explicar qué garantiza y qué no garantiza.

## Antes de solicitar revisión

- El cambio tiene tests relevantes, incluyendo casos inválidos y de autorización.
- Los tests de dominio no requieren servidor ni base real.
- Se verificaron errores, logs y límites de entrada.
- Se actualizaron API, modelo, glosario o ADR si el cambio los afecta.
- El pull request explica qué cambió, por qué y cómo probarlo.

## Definition of Done

Una tarea está terminada cuando:

- cumple su criterio de aceptación;
- tiene pruebas reproducibles;
- respeta los contratos compartidos;
- documenta decisiones y riesgos;
- no introduce secretos ni dependencias innecesarias;
- fue revisada por otra persona del grupo cuando el flujo Git esté habilitado.

## Convención de commits

Usar mensajes breves y descriptivos, por ejemplo: `docs: define estados iniciales de viaje`, `test: cover concurrent trip acceptance` o `feat: add driver offer expiration`. El mensaje debe explicar el cambio, no solo nombrar el archivo.
