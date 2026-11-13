# ADR 0024 · Combos

**Estado:** aceptada el 2026-11-04.

## Contexto

Los almacenes arman promos con varios productos distintos, por ejemplo «salchichas + pan de viena + mayonesa por $X». Juntos salen menos que por separado. Ni el porcentaje ni el N×M de la ADR 0020 cubren ese caso.

## Decisiones

1. **Un tipo más de promoción.** El combo tiene un precio para el conjunto y una lista de productos con cantidades, hasta 10 productos y al menos dos unidades en total.
   - Cuenta cualquier variante del producto.
   - Solo entran artículos que se venden por unidad.
   - Tiene las mismas fechas, pausa, plan y permisos que las demás promociones.
2. **Automático en la caja.** El cajero escanea cada producto como siempre. Si están todos, el servidor aplica el combo al cotizar y al vender.
   - Si hay unidades para dos combos, se arman dos.
   - Si sobran unidades, entran las más baratas, igual que en el N×M.
3. **Descuento repartido.** El descuento es lo que suman las unidades menos el precio del combo. Se reparte entre las líneas según lo que aporta cada una, y la última se lleva el redondeo. Cada línea guarda la promoción y su parte, así las devoluciones devuelven lo que realmente se pagó.
4. **Los combos van primero.** Una línea que entra en un combo no recibe otra promoción. Una línea con descuento manual no entra en combos.
5. **Precio de contado (ADR 0023).** Las unidades se valúan con la lista de la venta. Si el combo no resulta más barato, no se aplica.
6. **El stock baja de cada producto**, como en cualquier venta. El combo no es un artículo con código propio.

## Límites conocidos

- **Unidades que sobran de una línea en combo:** van a precio normal, sin otra promoción.
- **Combo armado con código de barras propio:** no está incluido, por ejemplo un pack en bolsa que descuenta los componentes al escanearlo.

## Verificación

- **Pruebas de integración:**
  - combo completo, doble, parcial y sin uno de los productos;
  - reparto del descuento;
  - venta;
  - no acumula con un porcentaje ni con el descuento manual;
  - validaciones;
  - aislamiento entre comercios.
- **Recorrido en el navegador:** alta del combo escaneando los productos y cobro en la caja.
