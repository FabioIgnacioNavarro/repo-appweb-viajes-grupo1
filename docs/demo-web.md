# Demo web del recorrido

## Propósito

Dar una representación visual sencilla del flujo de viaje de la demo de terminal: cargar origen y
destino, consultar el recorrido por calles y mostrar sus estados. Es una ayuda de presentación y no
forma parte del producto backend exigido por el trabajo práctico.

## Alcance

- Coordenadas de origen y destino editables, con valores iniciales de ejemplo en Resistencia.
- Ruta, distancia, duración y precio estimado calculados por el dominio con el proveedor configurado,
  mostrados sobre un mapa Leaflet con teselas de OpenStreetMap.
- Vigencia de tres minutos para la estimación; se puede actualizar recalculando el recorrido.
- Simulación manual de los estados `SOLICITADO`, `ASIGNADO`, `EN_CURSO` y `FINALIZADO`.
- Servidor Express local para servir los archivos de la página.

La página solicita la estimación al servidor Express local, que usa el mismo caso de uso y proveedor
de rutas configurado que la demo de terminal. El precio es orientativo y refleja la fórmula actual
de tarifa base, distancia y duración; los ajustes dinámicos por demanda, disponibilidad, clima y
franja horaria aún no están implementados. No confirma tarifas, no autentica usuarios y no persiste
viajes. Los botones de estados son una simulación visual independiente de la demo de terminal.

## Ejecución

Con Node.js 22 instalado, ejecutar `npm install` y luego `npm run demo:web`. Abrir
`http://localhost:3000`. Para cambiar el puerto, definir `PUERTO_DEMO_WEB` con un puerto entre 1 y
65535.

El mapa y las rutas requieren internet cuando el proveedor sea OSRM o Google. La página usa el
proveedor seleccionado mediante `RUTA_PROVEEDOR` y la URL de OSRM configurable con `OSRM_BASE_URL`;
las teselas provienen de OpenStreetMap. Los servicios públicos no se deben usar para cargas de
producción. Los datos cartográficos deben mostrar la atribución visible a OpenStreetMap.

## Criterio de aceptación

En un navegador, se ingresan dos pares de coordenadas válidos, se obtiene una ruta dibujada entre
ambos puntos con distancia, duración y precio en pesos enteros, y la vigencia de tres minutos se
indica en la pantalla. Los controles permiten recorrer los cuatro estados de prueba. Ante
coordenadas inválidas o error del proveedor, la página muestra un mensaje comprensible y permite
volver a intentar.
