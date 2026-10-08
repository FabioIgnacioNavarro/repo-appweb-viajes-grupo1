# ADR 0015: Demo web de recorrido con Leaflet y OpenStreetMap

- Estado: aceptado
- Fecha: 2026-10-08
- Participantes: Grupo 1 — Echeverría, Borchichi y Navarro

## Contexto

El grupo necesita mostrar visualmente el recorrido entre origen y destino de la demo. El backend
actual es una demo de terminal y no expone una API HTTP de viajes. La vista debe ser pequeña y no
duplicar reglas de negocio en el navegador.

## Decisión

Crear una página servida localmente por Express. La página solicita una estimación a un endpoint
auxiliar local, que llama al caso de uso de precio y ruta ya existente; recibe distancia, duración,
precio y polilínea para presentar todos los datos del mismo cálculo. Leaflet dibuja el mapa y las
teselas se cargan desde OpenStreetMap con la atribución requerida. La página permite avanzar
manualmente por estados locales para ilustrar el flujo, sin crear ni persistir un viaje.

## Alternativas

- Google Maps: descartado para esta demo porque requiere una clave y configuración de facturación.
  Su ventaja es la cobertura y el ecosistema integrado; su desventaja es configurar la cuenta y
  controlar el costo para una demo que no necesita funciones avanzadas.
- Integrar la vista con una API real de viajes: postergado hasta que exista el contrato y adaptador
  HTTP de viajes. La integración ofrecería datos reales del dominio; ahora exigiría inventar un
  contrato antes de que esté definido.
- Mapa propio o teselas alojadas por el grupo: descartado por el costo operativo innecesario para
  una demostración académica. Daría control de disponibilidad y estilo, a cambio de operar
  infraestructura cartográfica.

## Consecuencias

- Se puede mostrar una ruta real por calles sin una clave de Google.
- La demo requiere internet y depende de servicios públicos sin garantía de disponibilidad; no es
  apropiada para producción ni para carga automatizada.
- La simulación visual no prueba persistencia, autorización, precio ni concurrencia del backend.
- La tarifa mostrada es la tarifa base actual por distancia y duración. Los factores dinámicos
  acordados por el grupo todavía no están implementados.
- La atribución de OpenStreetMap debe permanecer visible y se respetará su política de uso de
  teselas.

## Revisión

Revisar la decisión cuando exista la API HTTP de viajes o cuando la demo necesite disponibilidad,
volumen o funciones que el servicio público de OSRM y las teselas de OpenStreetMap no ofrezcan.
