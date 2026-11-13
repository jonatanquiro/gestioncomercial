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
9. **Devoluciones.** Lo que se pagó con gift card vuelve a la tarjeta como saldo, no sale de la caja: primero a las tarjetas, hasta lo que se pagó con ellas, y el resto con el medio que elija el cajero. Así una gift card no se convierte en efectivo. Si la tarjeta ya venció, recibe 30 días más para poder usar ese saldo. En un cambio no aplica: el crédito paga la venta nueva.

## Impresión y dedicatoria (2026-11-04)

- **Dedicatoria opcional** de hasta 200 caracteres, junto a «Para» y «De».
- **Dos formatos de impresión**, porque es un regalo y no puede parecer un ticket común:
  - **en hoja** (A4 o carta, impresora común): una tarjeta a color con el logo y el color del comercio, para recortar;
  - **en ticket** (rollo de 80 mm): con guardas, el monto grande y la dedicatoria.

## Límites conocidos

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
