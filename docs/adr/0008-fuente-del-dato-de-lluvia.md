# ADR 0008: Proponer Open-Meteo para consultar la lluvia

- Estado: propuesto
- Fecha: 2026-09-29
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino, Navarro Fabio

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

## Decisión propuesta

Proponemos usar Open-Meteo para el prototipo académico, sujeto a que el grupo acepte la atribución CC BY 4.0 y confirme que el uso sigue siendo no comercial. Se consultará por coordenadas de la zona, se mapeará la respuesta a un puerto del dominio en español y se guardarán proveedor, ubicación/zona, precipitación, instante y antigüedad del dato. El código del proveedor y sus campos externos quedan confinados al adaptador.

La respuesta actual basada en modelo se tomará como dato de lluvia solo si la variable de lluvia del intervalo informado es mayor que cero milímetros. La consulta se hará por zona con caché, nunca por cada chofer ni en cada actualización de ubicación. Se propone refrescar como máximo con la frecuencia de 15 minutos del dato actual y reutilizar esa instantánea durante la vigencia de la estimación. Si el dato supera la antigüedad máxima configurada o el proveedor falla sin una instantánea utilizable, no se clasificará silenciosamente como “no llueve”; el caso debe quedar explícito en la política de errores de estimación.

Para desarrollar y probar se usará un adaptador falso con escenarios de lluvia, sin lluvia y proveedor caído. No se necesita una clave secreta para la API gratuita de Open-Meteo según la documentación actual; si se elige un plan comercial o cambia esa condición, las credenciales se guardan en variables de entorno.

## Consecuencias

La variante puede demostrarse sin depender de una página visual o scraping, y el simulador de 500 choferes no multiplicará llamadas meteorológicas por chofer. La interfaz del dominio queda intercambiable si el SMN publica una API adecuada o el grupo obtiene autorización de otro proveedor. Hay que atribuir Open-Meteo en la documentación/demo y revisar sus términos antes de publicar o distribuir el sistema.

## Qué nos haría cambiar de decisión

Un endpoint documentado del SMN con condiciones de reutilización adecuadas y datos actuales de calidad suficiente, la necesidad de garantía de disponibilidad, o un cambio en los términos de Open-Meteo.

## Fuentes consultadas

- [Documentación de variables actuales de Open-Meteo](https://open-meteo.com/en/docs): incluye precipitación y lluvia actual; el dato actual se basa en modelo de 15 minutos.
- [Términos de Open-Meteo](https://open-meteo.com/en/terms): uso educativo dentro del servicio gratuito, límite de consultas y licencia CC BY 4.0.
- [Planes y límites de Open-Meteo](https://open-meteo.com/en/pricing): uso no comercial del nivel gratuito y límites publicados.
- [Política de datos del SMN](https://www.argentina.gob.ar/normativa/nacional/norma-361173/texto): marco para acceder y reutilizar datos; verificar la licencia del conjunto concreto.
- [Preguntas frecuentes de InfoClima](https://infoclima.com/servicios/preguntas-frecuentes.asp): indica cómo insertar su pronóstico como sticker en un sitio web.
- [Condiciones de 1Weather](https://1weatherapp.com/brand/terms/): condiciones del servicio para usuarios; no se localizó documentación de API para desarrolladores.
