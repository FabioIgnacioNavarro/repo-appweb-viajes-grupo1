# ADR 0001: Usar TypeScript compilado a CommonJS

- Estado: propuesto
- Fecha: 2026-09-23
- Participantes: pendiente de completar

## Contexto

El proyecto debe ejecutarse sobre Node.js 22 y permite CommonJS o ESM, pero no mezclar ambos sin justificarlo. El grupo propone TypeScript y CommonJS inicialmente para mantener compatibilidad con herramientas conocidas del curso y una integración explícita con `require`/`module.exports`.

## Opciones consideradas

### CommonJS

Ventajas: curva de adopción baja para el equipo, integración simple con utilidades existentes y menor riesgo de mezclar configuraciones durante el inicio del proyecto.

Desventajas: sintaxis menos alineada con el ecosistema moderno de TypeScript y algunas diferencias de interoperabilidad con paquetes ESM.

### ESM

Ventajas: estándar moderno de JavaScript, imports estáticos y mejor alineación con documentación reciente.

Desventajas: exige resolver con cuidado extensiones, configuración de compilación y compatibilidad de dependencias; puede agregar fricción para una entrega reproducible del curso.

## Decisión

Usar CommonJS en la primera etapa. La decisión se aceptará definitivamente después de validar el arranque desde un clon limpio.

## Consecuencias

Toda la base del proyecto debe usar un único sistema de módulos. La configuración de TypeScript, tests y scripts debe producir y ejecutar CommonJS de forma consistente.

## Qué nos haría cambiar de decisión

Errores de interoperabilidad repetidos con dependencias críticas, o una necesidad justificada de usar ESM de extremo a extremo sin mezclar formatos.
