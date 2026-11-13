# ADR 0018 · Cuenta corriente con proveedores

**Estado:** aceptada el 2026-11-04.

## Contexto

El ingreso de mercadería (ADR 0014) cargaba stock y costos, pero no lo que se le debía a cada proveedor ni lo que se le iba pagando. Ese seguimiento se hacía por fuera del sistema, y un pago en efectivo salía de la caja como un retiro sin vínculo con el proveedor.

## Decisiones

1. **Deuda desde la compra.** Al ingresar mercadería con proveedor, se puede marcar «Queda para pagar al proveedor» con el importe de su factura, que puede ser distinto del costo por impuestos, fletes o descuentos. Ese importe (`purchases.payable_amount`) suma al saldo del proveedor. Lo carga quien tiene `purchases.create`, no quien solo recibe.
2. **Pagos** con `purchases.pay`: efectivo de una caja, transferencia, cheque u otro, con referencia y notas.
   - **En efectivo:** sale de una caja abierta como un movimiento propio (`supplier_payment`), con control de que alcance el efectivo.
   - **Los otros medios** no tocan la caja.
   - **Reintentos:** un pago se reintenta sin duplicar por `client_uuid`.
   - **Pagar de más** deja saldo a favor del comercio.
3. **El saldo se mueve con registros de solo agregado.** El saldo vigente se guarda en el proveedor y se bloquea en la transacción. Cada movimiento queda en `supplier_movements`: compra, pago o ajuste con motivo. El ajuste sirve para cargar lo que ya se debía al empezar, o una nota de crédito del proveedor.

## Límites conocidos

- **Pagos por compra:** no se imputan a una compra en particular, la cuenta es una sola por proveedor. Tampoco hay vencimientos de facturas de proveedores.

## Verificación

- **Pruebas de integración con MariaDB:**
  - compra con importe a pagar, que exige proveedor;
  - pago en efectivo que sale de la caja y no puede superar lo que hay;
  - reintento de un pago sin duplicar;
  - transferencia que no toca la caja;
  - saldo a favor y ajuste;
  - permisos de quien solo recibe;
  - aislamiento entre comercios.
- **Recorrido en el navegador:** compra que queda a pagar y pago en efectivo desde la ficha del proveedor.
