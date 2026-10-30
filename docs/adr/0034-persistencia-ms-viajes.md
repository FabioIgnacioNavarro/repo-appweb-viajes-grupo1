# ADR 0034: Persistencia de ms-viajes con SQL directo y puertos asíncronos

- Estado: propuesto
- Fecha: 2026-10-30
- Participantes: Borchichi Valentino (Flujo A); pendiente de revisión del grupo
- Concreta, para `ms-viajes`, lo que los ADR 0002 y 0026 dejaron abierto.

## Contexto

`ms-viajes` guarda viajes, ofertas, cobros e idempotencia en `Map` de memoria. Los puertos del
dominio (`RepositorioViajes`, `RepositorioOfertas`, `RepositorioCobros`, `RepositorioIdempotencia`)
son **síncronos**: `guardar(viaje): Viaje`. Un acceso a PostgreSQL es asíncrono por naturaleza, así
que no puede cumplir esa firma. Hay que decidir cómo acceder a la base y qué cambia en el dominio.

`ms-flota` ya usa el driver `pg` con SQL escrito a mano y un `schema.sql`; `ms-viajes` debe seguir
un patrón parecido para que el equipo mantenga una sola forma de trabajar.

## Opciones consideradas

### Opción A: SQL directo con `pg` y puertos que devuelven `Promise`

Ventajas reales:

- Control total de las sentencias críticas (`FOR UPDATE`, índice único parcial, `ON CONFLICT`),
  que son justamente lo que hay que demostrar en el trabajo.
- Sin dependencias nuevas: `pg` ya está instalado y lo usa `ms-flota`.
- Los tests pueden leer `schema.sql` tal como en `ms-flota`.

Desventajas reales:

- Hay que mapear a mano filas a objetos y escribir cada consulta.
- Los puertos y los casos de uso pasan a ser `async`, lo que obliga a modificar el dominio, la API
  HTTP y los tests existentes.

### Opción B: query builder (por ejemplo Knex)

Ventajas reales:

- Construye consultas con menos texto y ofrece migraciones.

Desventajas reales:

- Agrega una dependencia y toca `package.json` y el lockfile, que comparten los tres flujos.
- Las construcciones de bloqueo y las restricciones parciales igual terminan en SQL crudo.

### Opción C: ORM (por ejemplo Prisma o TypeORM)

Ventajas reales:

- Modelo tipado y migraciones generadas.

Desventajas reales:

- Oculta los bloqueos y las transacciones justo donde necesitamos controlarlos.
- Es una dependencia pesada que cuesta defender en el trabajo y arriesga conflictos de merge.

### Opción D: mantener los puertos síncronos con una caché en memoria y escritura diferida

Ventajas reales:

- No obliga a cambiar el dominio.

Desventajas reales:

- Rompe la garantía entre réplicas: la caché de cada proceso puede contradecirse y la escritura
  diferida puede perderse al reiniciar. Es exactamente el problema que se quiere resolver.

## Decisión

Se elige la **Opción A**.

1. **Puertos asíncronos.** Los puertos de `ms-viajes` pasan a devolver `Promise<...>`. Los casos de
   uso del dominio pasan a ser `async`. El dominio sigue sin importar `pg`, Express ni JWT.
2. **Dos adaptadores por puerto.** Uno en memoria (se conserva para los tests unitarios, ahora con
   firmas asíncronas) y uno PostgreSQL en `src/ms-viajes/postgres.ts`.
3. **Operaciones transaccionales como puerto.** La asignación y la cancelación necesitan varias
   escrituras atómicas. Se expresan como un puerto de dominio (una operación que el adaptador
   ejecuta dentro de una transacción) y no como una secuencia de llamadas sueltas.
   Las reglas de negocio se siguen decidiendo en el dominio; el SQL solo aplica las restricciones.
4. **Esquema.** `src/ms-viajes/schema.sql` crea `viaje`, `oferta`, `cobro` e `idempotencia`.
   Los importes son `BIGINT`, los factores de precio `JSONB`, los identificadores `TEXT`
   (el dominio genera ids con prefijo) y las fechas `TIMESTAMPTZ` en UTC. Es idempotente
   (`CREATE ... IF NOT EXISTS`) para poder aplicarse más de una vez.
5. **Aislamiento entre servicios.** Las tablas de `ms-viajes` no referencian tablas de otros
   servicios con claves foráneas: se guarda el `id` del usuario como dato, igual que hace
   `ms-flota`. Cada servicio solo escribe en sus tablas (ADR 0026).
6. **Fallar cerrado.** Si la base no responde, la API devuelve `503 DEPENDENCIA_NO_DISPONIBLE`
   sin detalles internos, y `/ready` responde `503` en lugar de decir "listo".
7. **Pool limitado.** Se crea un único `Pool` con tamaño configurable (`DATABASE_POOL_MAX`) y
   `DATABASE_URL` obligatoria, validada al iniciar.

## Consecuencias

- Qué gana el sistema: estado durable y consistente entre réplicas y reinicios, y SQL visible para
  explicar y defender cada garantía.
- Qué pierde: hay que reescribir los casos de uso como `async` y actualizar los tests y la API, con
  el riesgo de regresiones que eso implica.
- Qué queda más difícil: mantener a mano el mapeo entre filas y objetos, y el esquema versionado.
  Se mitiga con tests de integración contra PostgreSQL real que se omiten si no hay `DATABASE_URL`.

## Qué nos haría cambiar de decisión

Que el SQL escrito a mano se vuelva inmanejable por la cantidad de consultas, o que el grupo decida
introducir migraciones versionadas con una herramienta en todos los servicios a la vez.
