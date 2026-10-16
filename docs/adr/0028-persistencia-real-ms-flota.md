# Usamos PostgreSQL como persistencia real de `ms-flota`

**Estado:** aceptado  
**Fecha y participantes:** 2026-10-16 — equipo de desarrollo

## Contexto

`ms-flota` necesita conservar disponibilidad y ubicación actual entre reinicios. El adaptador en memoria es útil para pruebas unitarias, pero no puede ser la fuente de verdad del servicio. La aplicación debe rechazar ubicaciones antiguas también cuando hay concurrencia entre instancias.

## Opciones consideradas

### Memoria del proceso

Ventajas: implementación mínima y latencia baja.  
Desventajas: se pierde al reiniciar, no se comparte entre réplicas y no permite que `/ready` verifique una dependencia real.

### PostgreSQL mediante un adaptador de repositorio

Ventajas: persistencia durable, transacciones y actualización condicional para proteger el orden temporal de ubicaciones. Permite consultar cercanía con SQL y mantener el dominio testeable mediante el adaptador en memoria.  
Desventajas: agrega configuración, migraciones y una dependencia operativa.

## Decisión

PostgreSQL es la fuente de verdad de `ms-flota` cuando `DATABASE_URL` está configurada. Los casos de uso consumen puertos asíncronos, por lo que pueden usar indistintamente los adaptadores PostgreSQL o memoria.

## Consecuencias

Disponibilidad y ubicación sobreviven a reinicios, y la regla de “solo aceptar la ubicación más nueva” se aplica de forma atómica en PostgreSQL. El desarrollo local necesita iniciar la base y aplicar `src/ms-flota/schema.sql`; los tests unitarios no necesitan infraestructura externa.

## Qué nos haría cambiar de decisión

Cambiaríamos esta decisión si los volúmenes de ubicación exigieran una base especializada o si una medición reproducible demostrara que PostgreSQL no alcanza los objetivos de latencia y retención del proyecto.
