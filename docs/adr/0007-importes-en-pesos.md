# ADR 0007: Representar importes como pesos argentinos enteros exactos

- Estado: propuesto
- Fecha: 2026-09-29
- Participantes: Echeverría Maximiliano Joel, Borchichi Valentino

## Contexto

El sistema trabaja en pesos argentinos y el grupo decidió no manejar centavos. El enunciado advierte que usar el tipo `number` para dinero es un error frecuente. Los importes deben persistirse y calcularse sin aproximaciones binarias, pero también viajar por JSON.

## Opciones consideradas

### Usar `number` en JavaScript y una columna numérica aproximada

Ventajas: es directo en JavaScript y resulta cómodo para cálculos y respuestas JSON.

Desventajas: usa punto flotante binario, puede producir errores de precisión y contradice la advertencia explícita del enunciado.

### Usar enteros exactos en el dominio y la base, y cadenas en JSON

Ventajas: pesos enteros exactos sin centavos; PostgreSQL `BIGINT` y JavaScript `BigInt` evitan aproximaciones en el dominio. La cadena JSON conserva el valor exacto y se convierte sin pérdida.

Desventajas: se debe convertir explícitamente entre `BigInt` y cadena al entrar o salir de JSON, ya que JSON no serializa `BigInt` directamente.

## Decisión

Se propone representar los importes como pesos enteros ARS, sin centavos: `BIGINT` en PostgreSQL, `BigInt` en el dominio y cadena de dígitos en JSON, por ejemplo `"8086"`. El redondeo se realiza una sola vez al peso al final del cálculo, y cada respuesta incluye `moneda: "ARS"`.

## Consecuencias

Los importes no dependen del rango entero seguro de `number` ni sufren redondeo binario. Los adaptadores HTTP deben serializar y validar las cadenas numéricas; los cálculos de tarifa deben mantener exactos los importes hasta el redondeo final. Si el grupo incorpora centavos, deberá revisar la escala de almacenamiento y el cálculo.

## Qué nos haría cambiar de decisión

Un requisito que obligue a cobrar fracciones de peso, o una prueba que muestre pérdida de exactitud dentro de los límites de importes aceptados.
