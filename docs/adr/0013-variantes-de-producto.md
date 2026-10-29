# ADR 0013 · Variantes de producto (talle, color)

**Estado:** aceptada el 2026-10-29.

## Contexto

Desde el catálogo inicial (fase 3), lo que se vende, se stockea y tiene precio es la variante del producto, pero cada producto tenía una sola y la interfaz no la mostraba. Una tienda de ropa o de calzado necesita cargar un artículo con varios talles y colores, cada uno con su stock y, a veces, con su propio precio o código. Muchas prendas no tienen código de barras.

## Decisiones

1. **Propiedades libres, como Tienda Nube.** Un producto puede tener hasta 3 propiedades con el nombre que elija el comercio (`products.option_names`, por ejemplo `["Talle", "Color"]`). Cada variante guarda sus valores en el mismo orden (`product_variants.options`) y una etiqueta legible (`label`, por ejemplo «M / Rojo»), única por producto. Un producto sin propiedades tiene una sola variante sin etiqueta: es el caso de siempre.
2. **Por variante:** precio, costo, código interno, códigos de barras, stock y stock inicial. **Por producto:** nombre, categoría, marca, IVA, forma de venta, si controla stock, stock mínimo (se aplica a cada variante) y estado.
3. **Sin código de barras se vende igual.** El buscador del POS y de inventario lista variantes (`GET /products/items`): cada palabra tiene que aparecer en el nombre del producto o en la etiqueta de la variante («remera m rojo»). El código interno y el código de barras siguen siendo búsqueda exacta.
4. **Quitar una variante la desactiva.** Tiene ventas y movimientos, así que no se borra. Para quitarla, su stock tiene que estar en cero. Si después se vuelve a cargar la misma combinación, se reactiva la variante anterior, con su historial. El estado de la variante ya no copia el del producto: desactivar el producto alcanza para que no se venda.
5. **Función de plan.** Crear propiedades o variantes nuevas requiere la función `variants` del plan. Un comercio que deja de tenerla puede seguir editando y vendiendo las variantes que ya cargó.
6. **La línea de venta congela «Producto · etiqueta»** en la descripción, para que el ticket y las devoluciones muestren qué talle y color se vendieron.

## Fuera de alcance

La importación del CSV de productos de Tienda Nube va en un cambio aparte. No hay imágenes por variante ni precios por lista.
