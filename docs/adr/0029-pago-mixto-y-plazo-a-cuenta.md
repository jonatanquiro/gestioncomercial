# ADR 0029 · Pago mixto proporcional y plazo a contado en cuenta corriente

**Estado:** aceptada el 2026-11-13. Reemplaza la regla de pago mixto del ADR 0023 («si algo no es de contado, toda la venta va a precio de lista»).

## Contexto

Con la regla del ADR 0023, si un cliente pagaba una parte en efectivo y el resto con tarjeta o a cuenta, perdía el precio de contado en toda la compra.

Un ejemplo real: un artículo de $11.700 de contado y $14.700 de lista. El cliente entrega $3.000 en efectivo. Toda la venta pasaba a $14.700 y el ticket no explicaba por qué. Los comercios no cobran así y el ticket confundía.

La práctica de los comercios es otra:

- **Resto con tarjeta:** lo que se paga en efectivo va a precio de contado y solo lo que falta va con recargo.
- **Resto a cuenta:** el saldo queda a precio de contado durante un plazo (por ejemplo, una semana). Si no se paga en ese plazo, la venta pasa a precio de lista.

## Decisiones

1. **Medios «de contado».** Son los medios marcados «cobra a precio de contado», la gift card y, si el comercio da plazo, la cuenta corriente.
2. **Pago mixto proporcional.**
   - Lo que se paga con medios que no son de contado (N) cubre mercadería por `N × contado / lista`.
   - La diferencia es el recargo: `recargo = N − redondeo(N × C / L)`.
   - Ejemplo: contado 50.000 y lista 60.000. Se pagan 30.000 en efectivo y 24.000 con débito. Total: 54.000.
   - Si todo se paga con medios de contado, la venta va a contado. Si nada se paga así, va a lista.
3. **Cómo se guarda.**
   - Las líneas se guardan a precio de contado. El recargo se reparte en centavos entre las líneas, según cuánto más vale cada una a lista (`sale_lines.surcharge_amount`), y queda incluido en `line_total`.
   - Así la factura, las devoluciones y los reportes siguen usando `line_total` sin cambios.
   - La venta guarda `surcharge_total`, `list_total` y `price_list = 'mixed'`.
4. **Cuenta corriente con plazo.**
   - El plazo es `settings.accountTermDays`: 7 días por defecto y configurable por comercio.
   - Lo que queda a cuenta se debe a precio de contado hasta ese día (`account_terms`).
   - Si al vencer falta pagar algo, **toda la venta pasa a precio de lista**: se suma la diferencia lista − contado que todavía no se cobró (descontado el recargo que ya se cobró con tarjeta).
   - Ejemplo: compra de 50.000/60.000, paga 30.000 y debe 20.000. Si vence, debe 60.000 − 30.000 = 30.000.
   - Con 0 días no hay plazo y lo que va a cuenta se cobra a precio de lista, como antes.
5. **Pagos y devoluciones.**
   - Los cobros de cuenta corriente bajan primero lo que tiene plazo, del que vence antes al que vence después.
   - Una devolución baja el pendiente de esa venta y achica el recargo por vencimiento en proporción.
   - Anular la venta cierra el plazo.
6. **Cuándo se aplica el vencimiento.**
   - Al leer clientes o la ficha de uno, y antes de vender a cuenta o cobrar. No depende de un cron.
   - Cada plazo vence una sola vez, con su fila bloqueada.
   - Queda un movimiento «surcharge» en la cuenta y una entrada de auditoría `customer.term_surcharged`.
7. **Los mismos cálculos en la web y el servidor.** `mixedSurcharge` y `listAmountFor` están en `packages/domain` y en `App\Support\Pricing`, con casos compartidos en `pricing-cases.json`. `listAmountFor` busca el importe exacto al centavo que cubre lo que falta.
8. **En la caja y el ticket.**
   - **Caja:** muestra el precio de contado y el de lista, y explica qué medios van a contado. «Falta» se ve en efectivo y con tarjeta. Al cargar a cuenta, la caja muestra hasta qué día vale el precio de contado y cuánto debería después.
   - **Ticket:** muestra las líneas a contado, el recargo con el medio que lo generó y, si hay saldo a cuenta, cuánto debe hasta el vencimiento y cuánto desde el día siguiente.

## Verificación

- **Casos compartidos PHP/TypeScript** del recargo y del importe con tarjeta, incluido el ejemplo de $11.700 / $14.700.
- **`CashPriceTest`:**
  - contado, lista y mixto, con el reparto por línea;
  - no se da vuelto con tarjeta;
  - plazo con pago parcial a tiempo y vencimiento: debe lista − pagado, y el recargo se aplica una sola vez;
  - pago total a tiempo, sin recargo;
  - plazo en 0 días, que va a lista.
- **Pruebas de la caja** (`payment-mix.test.ts`) y un recorrido en el navegador de los dos casos, con sus tickets.
