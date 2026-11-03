# ADR 0015 · Gift cards

**Estado:** aceptada el 2026-11-03.

## Contexto

Los comercios de ropa, calzado y regalería venden órdenes de compra: alguien paga un monto para regalar y otra persona elige después qué llevarse. Es plata que entra hoy y mercadería que se entrega más adelante, así que el sistema tiene que saber en todo momento cuánto saldo queda a favor de los clientes.

## Decisiones

1. **La gift card se vende como una venta sin artículos.** El total es el monto de la tarjeta y se cobra con cualquier medio. Así entra a la caja, a cobros y a rendiciones sin un circuito aparte. La tarjeta (`gift_cards`) apunta a esa venta.
2. **Se usa como medio de pago.** Al cobrar se escanea o se escribe el código y se descuenta el importe del saldo. Se puede usar en una o varias compras y en cualquier sucursal, hasta agotar el saldo o hasta que vence. Lo pagado queda registrado con un medio interno de tipo `gift_card`, que se crea la primera vez que se usa. Como el crédito por cambio (ADR 0014), ese medio no se configura, no se elige como un medio más, no mueve efectivo y no es un cobro a rendir.
3. **El saldo se mueve con registros de solo agregado.** Cada movimiento queda en `gift_card_movements`: emisión, uso, anulación de la compra o anulación de la tarjeta. La tarjeta guarda el saldo vigente para bloquearlo (`lockForUpdate`) en la misma transacción de la venta. Así, dos cajas que intentan gastar el mismo saldo a la vez no pueden pasarse.
4. **Vencimiento.** Vale de 1 a 6 meses según se elija al venderla, con 6 por defecto, hasta el último día inclusive (hora de Argentina). El vencimiento va impreso en la tarjeta. Una tarjeta vencida no se usa, y su saldo deja de contarse como vigente.
5. **El código** es «GC» seguido de 10 caracteres al azar, sin letras ni números que se confundan. No es correlativo, para que no se pueda adivinar, y es único por comercio. Se imprime con un código de barras Code 128.
6. **«Vendido hoy»** cuenta la plata cuando entra, al vender la tarjeta. Lo que después se paga con ella se descuenta, igual que el crédito por cambio.
7. **Anulaciones.** Si se anula una compra pagada con gift card, el saldo vuelve a la tarjeta. La venta de una tarjeta se puede anular solo si la tarjeta no se usó, y en ese caso la tarjeta queda anulada.
8. **Facturación.** La venta de la tarjeta no se factura. Se factura la venta en la que se usa, con lo que se lleva el cliente.

## Límites conocidos

- **Devoluciones.** En una devolución de algo que se pagó con gift card, el reintegro se hace con un medio común: no vuelve a la tarjeta.
- **Saldo vencido.** Si la tarjeta vence con saldo, el saldo queda en el listado como vencido. No hay todavía un asiento contable que lo dé de baja.

## Verificación

- **Pruebas de integración con MariaDB:**
  - venta y caja;
  - uso parcial en dos compras;
  - rechazo por saldo insuficiente, por pasar el total, por vencimiento y por anulación;
  - anulación de la compra y de la tarjeta;
  - resumen del día;
  - aislamiento entre comercios;
  - cuatro cobros simultáneos con la misma tarjeta: solo uno pasa.
- **Recorrido en el navegador:** venta e impresión de la tarjeta, y cobro con la tarjeta.
