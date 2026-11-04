# ADR 0022 · Importar productos desde una planilla

**Estado:** aceptada el 2026-11-04.

## Contexto

Cargar el catálogo de a un producto frena el arranque. Un kiosco tiene cientos de artículos, y una tienda de ropa, decenas de productos con talles y colores. Casi todos ya los tienen en un Excel, en la lista de un proveedor o en otro sistema.

## Decisiones

1. **Planilla modelo según el rubro.**
   - Si el plan incluye variantes y el rubro las usa (ropa, calzado…), lleva columnas «Talle» y «Color».
   - Los rubros con venta por peso o medida suman la columna «Se vende por».
   - Trae tres hojas: «Productos» vacía, «Ejemplo» e «Instrucciones». Los códigos tienen formato texto para que Excel no los convierta en números.
2. **Sin bibliotecas nuevas.** El .xlsx (un ZIP con XML) se arma y se lee en el navegador con `CompressionStream`, `DecompressionStream` y `DOMParser` (`apps/web/src/lib/xlsx.ts`).
   - También se lee CSV con «;» o «,», en UTF-8 o en la codificación de Excel en Windows.
   - El .xls viejo no se lee: se pide guardarlo como .xlsx.
3. **Columnas por nombre.** Se reconocen sinónimos («Producto», «EAN», «PVP», «Rubro»…).
   - Las columnas desconocidas no se usan, salvo que se elijan como propiedad de variantes: «Talle», «Color», «Sabor»… vienen propuestas.
   - Las filas con el mismo nombre forman un producto con sus variantes.
4. **El servidor interpreta y valida** (`POST /products/import`).
   - La web manda las celdas como texto. El servidor entiende «$ 1.250,50», «1250.5» o «10,5 %».
   - Valida cada producto con las mismas reglas que el alta y devuelve los errores con el número de fila de la planilla.
   - Primero hay una vista previa (`dryRun`), y no se importa si queda algún error.
5. **Lo que ya existe no se duplica.** Una fila cuyo código de barras o código interno ya está cargado no crea nada.
   - Si se marca la opción (y se tiene `products.update`), actualiza el precio y el costo. Queda en el historial de precios.
   - El stock de lo existente no se toca: para eso están Compras y los ajustes.
6. **Categorías y marcas.** Las que no existen se crean, con su auditoría.
7. **Permisos y plan.**
   - Costo y stock inicial se cargan solo con `costs.update` y `stock.adjust`; si no, se avisa que no se tienen en cuenta.
   - Se respeta el límite de productos y la función de variantes del plan.
8. **Por partes.** En la prueba, 2000 filas tardaron unos 40 segundos en importarse de una vez, y eso supera el tiempo máximo de una página en el hosting. Por eso la web importa en partes de hasta 300 filas, sin separar las variantes de un producto. Cada parte es una transacción. Si una parte falla, se informa desde qué fila no se importó.

## Límites conocidos

- **Hasta 2000 filas** por planilla.
- **Mercadería de lo existente:** no se suma stock a lo que ya existe; eso va por Compras.
- **Imágenes:** no se importan.

## Verificación

- **Pruebas de integración:**
  - kiosco con categorías y marcas nuevas;
  - errores por fila sin importar nada;
  - variantes por nombre, con y sin el plan;
  - existentes con y sin actualizar precio;
  - formatos de números.
- **Pruebas de la web:**
  - escribir y leer .xlsx;
  - CSV en la codificación de Windows;
  - reconocer columnas;
  - partes sin separar variantes.
- **Recorrido en el navegador:**
  - ropa con talles y colores, desde una planilla hecha con otro programa;
  - kiosco con una lista de otro sistema, importada dos veces.
