# ADR 0023: Limitar timeouts y reintentos de llamadas HTTP

- Estado: aceptado
- Fecha: 2026-10-15
- Participantes: Joel Echeverría (implementación inicial)

## Contexto

Las llamadas de tarifas a rutas, clima, flota y viajes no deben retener el event loop ni acumular
reintentos cuando una dependencia está caída.

## Opciones consideradas

### Sin timeout ni reintentos

Ventajas: código sencillo y evita repetir tráfico.

Desventajas: una conexión colgada puede retener una solicitud indefinidamente.

### Timeout fijo y un reintento para lecturas seguras

Ventajas: limita la latencia y recupera fallas transitorias sin duplicar escrituras.

Desventajas: duplica una lectura ante ciertas fallas y necesita un presupuesto total documentado.

## Decisión

Timeout predeterminado: 1500 ms por intento para llamadas entre servicios y 1800 ms para proveedores
externos. Se permite un solo reintento, luego de 100 ms, solo para GET idempotentes ante timeout,
429, 502, 503 o 504. El presupuesto total por dependencia no supera 3.2 segundos en llamadas
internas y 3.8 segundos en proveedores externos. No se reintentan errores 4xx,
respuestas JSON inválidas ni operaciones de escritura. Los valores son configurables por entorno y
se validan al iniciar.

## Consecuencias

Se devuelve `503 DEPENDENCIA_NO_DISPONIBLE` al agotar el presupuesto. Las pruebas usan adaptadores
falsos. Las métricas registran servicio, operación, latencia y resultado, nunca tokens ni
coordenadas completas.

## Qué nos haría cambiar de decisión

Las mediciones muestran que 1500 ms impide el flujo normal o que un presupuesto mayor incumple la
latencia objetivo; el cambio requiere repetir las pruebas de caída.
