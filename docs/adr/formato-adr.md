# Formato de Registro de Decisión de Arquitectura (ADR)

Los ADR documentan decisiones técnicas relevantes del proyecto. Se escriben durante el desarrollo para registrar el razonamiento, las alternativas evaluadas y las consecuencias de cada decisión.

La carpeta debe contener como mínimo seis ADR numerados. Los cinco primeros temas son obligatorios:

1. **Sistema de módulos:** CommonJS o ESM, con las consecuencias de la elección.
2. **Persistencia y acceso a datos:** base elegida, y SQL directo, query builder u ORM.
3. **Autenticación y autorización:** JWT o sesiones, y cómo se verifica el acceso por recurso.
4. **Resolución de la condición de carrera principal del proyecto.**
5. **Solución de la tarea pesada:** cuál de las cuatro estrategias se elige y por qué.
6. Uno o más ADR adicionales sobre las decisiones más discutidas del grupo.

## Plantilla obligatoria

```markdown
# ADR NNNN: Título de la decisión

- Estado: propuesto | aceptado | reemplazado por ADR NNNN
- Fecha: AAAA-MM-DD
- Participantes: nombres de quienes participaron de la decisión

## Contexto

Qué problema hay que resolver y qué restricciones existen.

## Opciones consideradas

### Opción A

Ventajas reales:

Desventajas reales:

### Opción B

Ventajas reales:

Desventajas reales:

## Decisión

Qué se eligió y por qué.

## Consecuencias

Qué gana el sistema, qué pierde y qué queda más difícil de ahora en adelante.

## Qué nos haría cambiar de decisión

Condición concreta que obligaría a revisar esta decisión.
```

Un ADR que no nombra al menos dos alternativas consideradas, con ventajas y desventajas reales, no cumple el formato exigido. La decisión debe poder defenderse y relacionarse con pruebas, mediciones o documentación posterior.
