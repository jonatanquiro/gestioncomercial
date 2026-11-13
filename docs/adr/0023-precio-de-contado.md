# ADR 0023 · Precio de lista y precio de contado

**Estado:** aceptada el 2026-11-04.

## Contexto

Las tiendas de ropa y muchos otros comercios tienen un precio de lista (tarjeta, débito, transferencia) y uno más bajo de contado. Los kioscos, en cambio, suelen cobrar recargo si no se paga en efectivo. Es el mismo problema visto desde los dos lados: dos precios según cómo se paga. La ADR 0020 lo había dejado afuera («descuento por medio de pago»).

## Decisiones

1. **Dos precios en cada variante.** El de lista (`price`, el de siempre) y uno de contado opcional (`cash_price`).
   - Si el de contado no se carga, o es igual al de lista, se cobra el mismo precio con cualquier medio.
   - No puede ser mayor que el de lista.
   - Se carga en el alta del producto, en cada variante, en la importación (columna «Precio contado») y se ve en las etiquetas.
   - El kiosco con recargo carga el precio con recargo como lista y el de efectivo como contado.
2. **Medios de pago de contado.** Cada medio indica si «cobra a precio de contado».
   - Por defecto, solo el efectivo.
   - El comercio puede marcar otros, por ejemplo la transferencia.
3. **Toda la venta a un solo precio.** Se cobra a precio de contado solo si todo se paga con medios de contado. Las gift cards cuentan como contado, porque ya se pagaron. Si una parte se paga con otro medio o va a cuenta corriente, toda la venta va a precio de lista. Lo decidió Jona: es lo más simple de explicar en el mostrador.
4. **El servidor decide la lista.** La lista sale de los medios de pago del pedido y se calcula con ella. Si el total esperado no coincide, responde «cambió el precio» con la lista y los dos precios.
   - **Registro en la venta:** la venta guarda `price_list` y cada línea, el precio cobrado, así las devoluciones y reportes usan lo que se pagó.
   - **En la caja:** se ven los dos totales, y al cobrar el total cambia según el medio elegido.
5. **Promociones:** se calculan sobre el precio de la lista que corresponde. La cotización acepta `priceList`.
6. **Cambio masivo de precios:** el precio de contado mantiene la misma proporción con el de lista, redondeado igual.
7. **Cambios:** lo nuevo va a precio de lista, como ya iba sin promociones (ADR 0020).

## Límites conocidos

- **Historial de precios:** el precio de contado no tiene un historial propio. Sus cambios quedan en la auditoría del producto.
- **Cuotas con recargo distinto:** no hay cuotas con recargos diferentes por cantidad de cuotas; el precio de lista es uno solo.

## Verificación

- **Pruebas de integración:**
  - validación del precio de contado;
  - venta en efectivo, mixta, con transferencia marcada como contado y a cuenta corriente;
  - cotización;
  - cambio masivo;
  - importación.
- **Recorrido en el navegador:** carrito con los dos totales, y cobro en efectivo y con débito.
