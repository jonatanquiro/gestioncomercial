# ADR 0016 · Clientes y cuenta corriente

**Estado:** aceptada el 2026-11-04.

## Contexto

Muchos comercios de barrio venden fiado: anotan en una libreta lo que se llevó cada cliente y lo que va pagando. También facturan seguido a los mismos clientes y cargan sus datos cada vez. Hacía falta una ficha de cliente y una cuenta corriente que no descuadre la caja.

## Decisiones

1. **Ficha de cliente** (`customers`): nombre, documento (DNI, CUIT o CUIL, validados), condición frente al IVA, contacto y domicilio. El documento es único por comercio. La venta puede tener cliente, y la factura toma sus datos.
2. **Venta a cuenta corriente.** Al cobrar, una parte o todo se carga a la cuenta con un medio interno de tipo `account` («Cuenta corriente»). Ese medio se crea la primera vez que se usa y, como el crédito por cambio y la gift card, no mueve efectivo ni es un cobro a rendir. Hace falta el permiso `accounts.grant_credit`.
3. **Límite de crédito.** Un cliente sin límite no compra a cuenta. Con límite, lo que debe más lo nuevo no puede pasarlo. El saldo a favor (negativo) se usa aunque el cliente no tenga límite. El límite lo carga quien tiene `accounts.grant_credit`.
4. **El cobro de la deuda es una venta sin artículos** de tipo `account_payment`, como la venta de una gift card. Así entra a la caja, a cobros y a rendiciones con cualquier medio. No se cobra más de lo que debe el cliente, y no se factura: la factura corresponde a la venta en la que se llevó la mercadería. Requiere `accounts.collect`.
5. **El saldo** se guarda en el cliente y se bloquea en la misma transacción. Cada cambio queda en `customer_movements`, de solo agregado:
   - compra a cuenta;
   - pago;
   - devolución;
   - anulación;
   - ajuste con motivo, para cargar el saldo de la libreta al empezar o para corregir.
6. **«Vendido hoy»** cuenta la venta fiada cuando se hace. El cobro posterior no es una venta del día, pero su plata sí entra en efectivo y en cobros.
7. **Devoluciones y anulaciones.**
   - **Devolución de algo fiado:** baja la deuda en lugar de sacar plata de la caja. Primero vuelve lo pagado con gift card, después lo fiado y el resto con el medio elegido.
   - **Anulación de una venta fiada:** saca de la cuenta lo que se cargó.
   - **Anulación de un cobro:** vuelve a sumar la deuda.
8. **`sales.kind`** distingue la venta de mercadería (`sale`), la venta de una gift card (`gift_card`) y el cobro de cuenta corriente (`account_payment`).

## Verificación

- **Pruebas de integración con MariaDB:**
  - validación y unicidad del documento;
  - permisos del cajero sobre el crédito;
  - fiado con límite y pago mixto;
  - cobro con vuelto y sin pasar la deuda;
  - resumen del día y cobros a rendir;
  - devolución que baja la deuda;
  - anulaciones;
  - ajuste y saldo a favor;
  - aislamiento entre comercios.
- **Recorrido en el navegador:** alta de un cliente con crédito, venta fiada desde la caja y cobro desde la ficha.
