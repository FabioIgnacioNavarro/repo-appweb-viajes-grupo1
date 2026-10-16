# ADR 0026: Usar PostgreSQL como fuente de verdad y postergar Redis

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Joel Echeverría (implementación inicial)

## Contexto

El sistema persiste reglas de tarifa, estimaciones, viajes, ofertas, choferes, ubicaciones e
idempotencia. Redis podría apoyar cache y coordinación, pero cada uso necesita una política de
consistencia con la fuente persistente.

## Opciones consideradas

### PostgreSQL y Redis desde el inicio

Ventajas: Redis ofrece expiración y lecturas rápidas; PostgreSQL ofrece transacciones y restricciones.

Desventajas: dos fuentes de estado exigen consistencia, operación y manejo de fallos adicionales.

### PostgreSQL como fuente de verdad; Redis diferido

Ventajas: transacciones, restricciones, `BIGINT`, JSONB e índices cubren el vertical con menos puntos
de fallo.

Desventajas: cache y expiraciones se resuelven inicialmente con SQL y pueden requerir medición.

## Decisión

PostgreSQL es la fuente persistente de los tres servicios. Redis no se incorpora en este vertical;
idempotencia y vigencia se guardan en PostgreSQL con restricciones y fechas de expiración. Las bases
lógicas se separan mediante esquemas por servicio en una instancia local de Compose; cada servicio
solo escribe en sus tablas.

## Consecuencias

Se necesitan migraciones versionadas, pool limitado y checks de readiness. Los adaptadores en memoria
se limitan a tests y no reemplazan los adaptadores productivos.

## Qué nos haría cambiar de decisión

Una medición de latencia o contención que justifique cache o coordinación en Redis, con política de
reconciliación y fuente de verdad explícitas.
