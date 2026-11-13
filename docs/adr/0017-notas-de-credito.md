# ADR 0017 · Notas de crédito ARCA

**Estado:** aceptada el 2026-11-04.

## Contexto

Hasta ahora, una venta con factura real no admitía devolución ni anulación: el sistema la frenaba porque no emitía notas de crédito. En el mostrador eso bloqueaba un cambio o una devolución común de un cliente que había pedido factura.

## Decisiones

1. **Primero la operación, después el comprobante.** Una venta con factura autorizada se devuelve o se anula como cualquier otra: el stock y la caja no esperan a ARCA. Después, desde la venta, se emite la nota de crédito. Mientras falte, la venta lo avisa.
2. **Una nota de crédito por cada devolución**, por lo devuelto y con las alícuotas de cada línea, y **una por la anulación**, por el total. Todas se asocian a la factura (`CbtesAsoc`) con el mismo receptor. El tipo sale de la factura: A → 3, B → 8 y C → 13.
3. **El mismo circuito que la factura.** El número se guarda antes de pedir el CAE. Si la respuesta no llega, se consulta el mismo comprobante en lugar de emitir otro, y un reintento devuelve la nota ya autorizada.
4. **Modelo de datos.** `fiscal_invoices` guarda facturas y notas de crédito (`kind`), con `sale_return_id` y `associated_invoice_id`. La unicidad pasa a ser un comprobante por venta, ambiente y documento (`document_key`): la factura, cada devolución o la anulación.
5. **Factura pendiente.** Con una factura pendiente de confirmación en ARCA, la venta sigue sin poder devolverse ni anularse: hasta que ARCA responda, no se sabe si quedó facturada.
6. **Ventas con devoluciones.** Una venta que ya tiene devoluciones sigue sin poder facturarse.

## Verificación

- **Pruebas de integración con respuestas de ARCA simuladas:**
  - devolución de una venta facturada y su nota de crédito tipo 13, asociada a la factura y por el importe devuelto;
  - un reintento no duplica la nota;
  - nota de crédito por anulación;
  - rechazo si la venta no tiene factura;
  - bloqueo con una factura pendiente.
- **Antes de usarlo en producción:** probar una nota de crédito en homologación con el certificado del comercio.
