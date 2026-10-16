# ADR 0008: Proponer Open-Meteo para consultar la lluvia

- Estado: aceptado para el prototipo académico
- Fecha: 2026-09-29
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino

## Contexto

El precio dinámico necesita conocer si llueve en la zona y al momento de generar una estimación. La consulta debe automatizarse desde el servidor, permitir guardar la fuente y la fecha del dato para auditar el precio, y no depender de extraer información de una página web.

## Opciones consideradas

### Servicio Meteorológico Nacional (SMN)

Ventajas: es la fuente meteorológica oficial argentina. Su política de datos contempla reutilización con licencias y atribución según la clase del dato.

Desventajas: todavía no confirmamos una API pública, estable y documentada que entregue precipitación actual por coordenadas con las condiciones de uso específicas para ese producto. La política general no sustituye revisar la licencia del conjunto de datos concreto.

### Open-Meteo

Ventajas: documenta un endpoint por latitud y longitud y ofrece la variable de lluvia/precipitación en las condiciones actuales, basadas en datos de modelo de 15 minutos. Sus términos permiten el uso educativo no comercial del nivel gratuito y el límite publicado es menor a 10.000 consultas por día.

Desventajas: no es el servicio meteorológico oficial argentino, requiere atribuir los datos bajo CC BY 4.0, no ofrece garantía de disponibilidad en el plan gratuito y sus términos pueden cambiar. Los datos son modelados y pueden diferir de una estación de lluvia local.

### InfoClima y 1Weather

Ventajas: ofrecen información meteorológica para usuarios finales.

Desventajas: en la documentación pública revisada, InfoClima describe un código para insertar un pronóstico en un sitio web, no una API de backend; para 1Weather no encontramos documentación pública de una API para desarrolladores. No se debe extraer datos de sus páginas mediante scraping; habría que pedirles acceso y condiciones de uso.

## Decisión

Se usa Open-Meteo para el prototipo académico no comercial y se conserva la atribución CC BY 4.0. Se consulta por coordenadas de la zona, se mapea la respuesta a un puerto del dominio en español y se guarda proveedor, ubicación/zona, precipitación, instante y antigüedad del dato. El código del proveedor y sus campos externos quedan confinados al adaptador.

La variable actual `precipitation` se toma como lluvia cuando supera cero milímetros. La consulta se hace por zona con caché, nunca por chofer ni actualización de ubicación. La caché vence a los 15 minutos y la instantánea se reutiliza durante la vigencia de la estimación. Si el dato supera esa antigüedad o el proveedor falla sin una instantánea utilizable, se rechaza la estimación; no se clasifica silenciosamente como “no llueve”.

Para desarrollar y probar se usa un adaptador falso con escenarios de lluvia, sin lluvia y proveedor caído. La API gratuita actual no requiere clave; si se elige un plan comercial o cambia esa condición, las credenciales se guardan en variables de entorno.

## Consecuencias

La variante puede demostrarse sin depender de scraping, y el simulador no multiplica llamadas por chofer. La interfaz queda intercambiable si el SMN publica una API adecuada. El nivel gratuito admite contenido educativo no comercial con atribución CC BY 4.0, no ofrece SLA y publica límites de frecuencia; se revisarán sus [términos vigentes](https://open-meteo.com/en/terms) antes de distribuir el sistema.

## Qué nos haría cambiar de decisión

Un endpoint documentado del SMN con condiciones de reutilización adecuadas y datos actuales de calidad suficiente, la necesidad de garantía de disponibilidad, o un cambio en los términos de Open-Meteo.

## Fuentes consultadas

- [Documentación de variables actuales de Open-Meteo](https://open-meteo.com/en/docs): incluye precipitación y lluvia actual; el dato actual se basa en modelo de 15 minutos.
- [Términos de Open-Meteo](https://open-meteo.com/en/terms): uso educativo dentro del servicio gratuito, límite de consultas y licencia CC BY 4.0.
- [Planes y límites de Open-Meteo](https://open-meteo.com/en/pricing): uso no comercial del nivel gratuito y límites publicados.
- [Política de datos del SMN](https://www.argentina.gob.ar/normativa/nacional/norma-361173/texto): marco para acceder y reutilizar datos; verificar la licencia del conjunto concreto.
- [Preguntas frecuentes de InfoClima](https://infoclima.com/servicios/preguntas-frecuentes.asp): indica cómo insertar su pronóstico como sticker en un sitio web.
- [Condiciones de 1Weather](https://1weatherapp.com/brand/terms/): condiciones del servicio para usuarios; no se localizó documentación de API para desarrolladores.
