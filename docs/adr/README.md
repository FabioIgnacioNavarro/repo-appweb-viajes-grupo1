# ADR

Cada decisión relevante se registra en un archivo numerado. Todo ADR debe incluir: título, estado, fecha y participantes, contexto, al menos dos opciones con ventajas y desventajas reales, decisión, consecuencias y condición que obligaría a revisarla.

ADRs mínimos previstos:

1. Sistema de módulos: CommonJS o ESM.
2. Persistencia y acceso a datos: PostgreSQL y SQL/query builder/ORM.
3. Autenticación y autorización por recurso.
4. Resolución de la doble asignación viaje-chofer.
5. Solución de la tarea pesada de ubicaciones y búsqueda.
6. Canal de tiempo real y reconexión, o la decisión específica más importante del grupo.

Decisiones adicionales registradas:

7. Representación de importes en pesos argentinos sin centavos.
8. Fuente del dato de lluvia para el precio dinámico.
9. Separación de ubicación actual e histórica del chofer.
10. Política de retención de ubicaciones históricas de viajes.
11. Referencias genéricas de ubicación por usuario y roles habilitados.
