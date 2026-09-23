# AGENTS.md

## Propósito del repositorio

Este repositorio contiene el trabajo práctico de Programación IV: una plataforma backend de viajes tipo Uber para pasajeros, choferes, operadores y administradores.

La prioridad del proyecto es cumplir el enunciado académico y poder demostrar el comportamiento del sistema bajo concurrencia, fallas, carga y ataques controlados. El frontend web o móvil es secundario y no debe desplazar el trabajo del backend, las pruebas ni la documentación.

## Alcance técnico inicial

- Node.js 22 LTS.
- Express como framework HTTP.
- TypeScript como lenguaje de implementación.
- CommonJS como sistema de módulos inicial.
- PostgreSQL como base de datos relacional candidata y opción predeterminada mientras se completa el ADR de persistencia.
- Docker y Docker Compose para reproducir el entorno.
- Arquitectura hexagonal: dominio aislado, puertos, adaptadores y un único punto de composición.

## Reglas de trabajo

1. Antes de implementar, actualizar la documentación de dominio, API, decisiones o mediciones que corresponda.
2. No colocar reglas de negocio en rutas Express, controladores, consultas SQL ni adaptadores externos.
3. El dominio no debe importar Express, el driver de PostgreSQL ni librerías de infraestructura.
4. Toda dependencia externa entra por un puerto y debe tener un adaptador real y uno falso o en memoria para pruebas.
5. Toda configuración se obtiene de variables de entorno y se valida al iniciar.
6. No versionar secretos, `.env` reales, `node_modules` ni datos personales.
7. Las operaciones sensibles deben considerar autorización por recurso, idempotencia y concurrencia desde el diseño.
8. Cada decisión relevante se registra en `docs/adr/` con alternativas reales y consecuencias.
9. No agregar código “duro” o infraestructura prematura sin que exista primero una necesidad documentada y una prueba que la justifique.
10. Mantener comandos reproducibles para instalación, preparación, pruebas, lint y ejecución.

## Prioridades del dominio

La invariante central es que un viaje activo se asigna a un solo chofer y un chofer no puede tener más de un viaje activo. Toda modificación de estados, asignación, cancelación y cobro debe diseñarse para resistir pedidos simultáneos.

La variante obligatoria confirmada para este grupo es la **A: precio dinámico por demanda**. Debe implementarse además de todo el alcance común.

La demanda se calcula por zona con una regla configurable y auditable. El pasajero debe ver el multiplicador antes de confirmar; al confirmar, el multiplicador y los datos usados para calcularlo quedan registrados y el precio confirmado no cambia aunque la demanda varíe durante el viaje.

## Documentación obligatoria

- `docs/modelo.md`: entidades, invariantes, estados y diagrama.
- `docs/api.md`: contrato inicial de endpoints, respuestas y errores.
- `docs/glosario.md`: vocabulario oficial del dominio.
- `docs/contratos.md`: convenciones compartidas entre módulos y agentes.
- `docs/flujo-trabajo.md`: proceso para proponer, implementar y verificar cambios.
- `docs/backlog.md`: trabajo pendiente, prioridades y criterios de aceptación.
- `docs/mediciones.md`: hipótesis, método y resultados de carga.
- `docs/ataque.md`: bitácora de ataque cruzado y respuesta a hallazgos.
- `docs/adr/`: decisiones arquitectónicas numeradas.

## Regla de compatibilidad entre agentes

Si una instrucción nueva contradice la documentación existente, no cambiar silenciosamente el contrato. Primero señalar la discrepancia, actualizar el documento correspondiente y recién después implementar. Los nombres del glosario, los estados del modelo y los contratos compartidos son la fuente común de verdad.

## Verificación esperada antes de entregar

La secuencia de un clon limpio debe quedar documentada y funcionar con Docker Compose: copiar `.env.example`, levantar servicios, preparar la base, cargar datos de prueba, ejecutar todos los tests y correr la demo de requests.
