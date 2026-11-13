# ADR 0028 · Etiquetas masivas, rollos y hojas configurables

**Estado:** aceptada el 2026-11-13.

## Contexto

La pantalla de Etiquetas (ADR 0014) tenía solo dos formatos fijos: un rollo de 50 × 25 mm y una hoja A4 de 24 etiquetas. Además, los artículos se cargaban de a uno.

Los comercios usan sobre todo impresoras térmicas, pero con rollos de distintas medidas y de 1, 2 o 3 columnas. Los que no tienen térmica imprimen en hojas autoadhesivas A4 o Carta, y cada marca de hoja tiene otra grilla y otros márgenes.

## Decisiones

1. **Medidas configurables.**
   - **Rollo:** ancho y alto de la etiqueta, columnas (1 a 4), borde y separación. Cada fila del rollo es una página del tamaño exacto (`@page`).
   - **Hoja:** papel A4 o Carta, columnas, filas, márgenes y separaciones. Cada etiqueta se ubica en su posición absoluta en milímetros.
   - Hay formatos comunes ya cargados y la opción «Otra medida».
   - Se valida que la grilla entre en el papel, con medio milímetro de tolerancia.
2. **Calibración.** Se puede correr todo en X e Y, y dibujar el contorno de cada etiqueta para probar en una hoja común antes de gastar etiquetas.
3. **La configuración se guarda en cada compu** (`localStorage`), porque cada caja tiene su impresora. Si no hay almacenamiento, se usan los valores por defecto.
4. **Hojas llenas con distintos artículos.**
   - Las etiquetas se reparten en orden y llenan una hoja antes de pasar a la siguiente.
   - «Empezar en la etiqueta n°» aprovecha una hoja ya usada.
   - «Completar la hoja» suma copias del último artículo hasta llenar los lugares libres.
5. **Carga masiva.**
   - **«Agregar varios»:** carga una categoría, una búsqueda o solo lo que tiene stock. Puede poner una etiqueta por unidad o una de cada artículo.
   - **Desde un ingreso de mercadería:** «Imprimir etiquetas» pone tantas etiquetas como unidades entraron.
   - Lo que se vende por peso o medida lleva una sola etiqueta.
   - `GET /products/items` acepta `variantIds` (hasta 100 por pedido).
6. **Topes.**
   - Hasta 3000 artículos en la lista y 5000 etiquetas por impresión.
   - La generación de códigos internos se pide en tandas de 500, solo para los que no tienen código.

## Verificación

- **Pruebas unitarias:**
  - todos los formatos predefinidos entran en su papel;
  - posiciones con márgenes y calibración;
  - reparto en hojas con lugares salteados;
  - errores de medidas.
- **Prueba de integración:** `variantIds` devuelve esas variantes y rechaza ids inválidos.
- **Recorrido en el navegador:**
  - el PDF de impresión sale con páginas de 210 × 297 mm en hoja;
  - en el rollo de 2 columnas sale con filas de 86 × 25 mm;
  - cada etiqueta cae en su lugar.
