# ADR 0012: Separar la identidad personal de los usuarios y sus perfiles por rol

- Estado: aceptado
- Fecha: 2026-10-08
- Participantes: pendiente de completar con los integrantes del grupo

## Contexto

Una misma persona puede actuar como pasajero, chofer, soporte o administrador. Sin embargo, cada usuario del sistema debe tener un único rol y ese rol no cambia. Los datos personales, las credenciales y los atributos propios de un chofer tienen responsabilidades distintas.

También se necesita que las relaciones de viajes, ofertas y ubicaciones identifiquen al actor autenticado mediante `usuario.id`, sin depender de una tabla específica de perfil.

## Opciones consideradas

### Opción A: una sola entidad `Usuario` con todos los datos personales y de todos los roles

Ventajas:

- Modelo inicial simple.
- Menos tablas y relaciones.
- Consultas directas para un prototipo pequeño.

Desventajas:

- Mezcla datos personales, credenciales y atributos específicos de cada rol.
- Produce columnas nulas y reglas condicionales difíciles de mantener.
- No representa naturalmente que una persona pueda tener varios roles independientes.
- Complica la autorización y la evolución de nuevos perfiles.

### Opción B: `Persona`, `Usuario` y perfiles específicos por rol

Ventajas:

- Los datos personales se almacenan una sola vez.
- Una persona puede tener varios usuarios, uno por rol.
- Cada usuario tiene una sola identidad autenticable y un solo rol.
- Los perfiles contienen únicamente atributos específicos; por ahora solo se necesita `UsuarioChofer`.
- Las relaciones de negocio pueden usar `usuario.id` de forma uniforme.

Desventajas:

- Agrega joins y validaciones entre persona, usuario y perfil.
- Hay que garantizar que un usuario chofer tenga su perfil correspondiente.
- El sistema debe impedir dos usuarios de la misma persona con el mismo rol.

### Opción C: un usuario con una relación muchos-a-muchos de roles

Ventajas:

- Permite agregar y quitar roles sin crear usuarios nuevos.
- Evita repetir una cuenta para una misma persona.

Desventajas:

- Contradice la regla del proyecto de un rol por usuario.
- Hace más ambiguas las credenciales, sesiones y permisos.
- Exige resolver qué identidad representa cada acción cuando una persona tiene varios roles.

## Decisión

Se elige la opción B. `Persona` contiene los datos personales; `Usuario` contiene la identidad autenticable y exactamente un rol; `Credencial` mantiene la autenticación; y `UsuarioChofer` contiene los atributos específicos del chofer.

Las relaciones de `Viaje`, `Oferta`, `UbicacionActual` y `UbicacionHistorica` referencian `usuario.id`. No se crea `UsuarioPasajero` hasta que el pasajero tenga atributos propios que lo justifiquen.

## Consecuencias

- Se evita duplicar el correo y los datos personales cuando una persona tiene varios roles.
- Los casos de uso deben validar el rol del usuario y, cuando corresponda, la existencia de su perfil específico.
- `usuario_chofer.usuario_id` debe ser único.
- `UNIQUE(persona_id, rol_usuario)` evita duplicar un rol para una misma persona.
- La ubicación genérica puede compartirse entre pasajeros y choferes sin depender de perfiles concretos.
- La complejidad adicional queda concentrada en la composición de identidad y autorización.

## Qué nos haría cambiar de decisión

Se revisará si la consigna permite que una misma cuenta tenga simultáneamente varios roles, si desaparece la necesidad de separar datos personales de perfiles o si las consultas y validaciones introducen una complejidad que no pueda justificarse con pruebas.
