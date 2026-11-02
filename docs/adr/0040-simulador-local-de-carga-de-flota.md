# ADR 0040: Simulador local y repetible de carga de Flota

- Estado: aceptado
- Fecha: 2026-11-02
- Participantes: Grupo 1 — Flujo B

## Contexto

La consigna requiere medir `ms-flota` con 500 choferes actualizando ubicación cada dos segundos, junto con búsquedas de cercanía y sondas de salud. La medición debe producir latencias por percentiles, throughput, errores HTTP, uso de CPU/memoria y lag del event loop. No debe depender de servicios públicos, credenciales reales ni datos personales.

## Opciones consideradas

### Opción A: herramienta externa de carga (k6 o Artillery)

Ventajas:
- Ofrece planificación de carga y reportes de rendimiento maduros.
- Facilita distribuir la carga entre varios generadores.

Desventajas:
- Agrega herramientas y configuración que cada integrante debe instalar y mantener.
- La preparación de los 500 perfiles, los JWT falsos del proyecto y la limpieza segura requieren adaptadores adicionales.

### Opción B: simulador propio con Node.js y APIs nativas

Ventajas:
- Usa `fetch`, temporizadores y procesos secundarios incluidos en Node.js 22, sin sumar dependencias.
- Puede usar JWT falsos compatibles con el proyecto y datos sintéticos reproducibles.
- Puede restringir el destino a localhost, preparar perfiles temporales dentro del PostgreSQL de Compose y eliminarlos al terminar.

Desventajas:
- El generador se ejecuta en la misma máquina que los servicios y puede competir por CPU.
- No reemplaza una plataforma distribuida de carga ni produce una garantía de capacidad para producción.

## Decisión

Se elige la opción B para el benchmark académico local. El ejecutable vive en `carga/simulador.mjs`; usa el gateway local, PostgreSQL local y un archivo Compose adicional que habilita métricas de proceso solo durante la prueba.

El simulador crea perfiles con UUID aleatorios, coordenadas deterministas alrededor de Resistencia y tokens falsos distintos por chofer. Si una inserción colisiona, se detiene sin modificar filas existentes. En la salida normal y al recibir interrupción intenta borrar únicamente los UUID que insertó esta ejecución. El destino HTTP se limita a `localhost`, `127.0.0.1` o `::1`, y se rechazan contextos Docker remotos.

El modo completo ejecuta 60 segundos de calentamiento, 300 segundos medidos y 60 segundos de recuperación. El escenario de carga distribuye las actualizaciones a lo largo de cada intervalo de dos segundos; reposo conserva las búsquedas y sondas sin actualizaciones. El modo corto sirve para comprobar el flujo y no se presenta como resultado de aceptación.

La instrumentación de `ms-flota` se activa únicamente con `MEDICIONES_HABILITADAS=true`. Publica en logs ventanas de `monitorEventLoopDelay` y RSS del proceso. Docker Stats recoge CPU y memoria del contenedor; ambas métricas se informan por separado.

## Consecuencias

- El benchmark no inicia al arrancar la aplicación: solo corre cuando un integrante ejecuta el comando del simulador.
- El modo corto permite validar conectividad, autenticación, recolección y limpieza sin enviar la carga completa.
- Los reportes se guardan en `carga/resultados/`, excluidos de Git porque dependen del hardware y entorno local. Los resultados aceptados deben resumirse en `docs/mediciones.md` junto con el SHA y las condiciones de ejecución.
- Una ventana de event loop produce un p99 por segundo; el p99 reportado resume los p99 de esas ventanas. Se informa el máximo observado aparte.
- Los resultados locales describen el entorno ensayado y no se extrapolan directamente a producción.

## Qué nos haría cambiar de decisión

Se evaluaría k6/Artillery o generadores separados si el equipo del host limita el throughput, si la máquina del generador satura antes que `ms-flota`, o si la cátedra exige una herramienta específica.
