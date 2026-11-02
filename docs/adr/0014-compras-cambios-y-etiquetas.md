# ADR 0014 · Ingreso de mercadería, cambios y etiquetas

**Estado:** aceptada el 2026-11-02.

## Contexto

En el recorrido de punta a punta quedaron tres huecos en el día a día. La mercadería que llegaba se cargaba como «ajuste de stock», sin proveedor y sin actualizar el costo. Un cambio de talle eran dos operaciones (devolución y venta nueva) que movían plata que en realidad no se movía. Y lo que no tiene código de barras, como la ropa, solo se podía vender buscándolo por nombre.

## Decisiones

1. **Ingreso de mercadería.** Una compra (`purchases`, `purchase_lines`) suma stock con un movimiento `purchase_in` por línea, numerada por sucursal como las ventas. El proveedor y el costo son opcionales. Con «actualizar costos», el costo de la línea pasa a ser el costo vigente con origen `purchase` en el historial. Cargar costos exige `costs.update`: quien solo tiene `purchases.receive` carga cantidades. Una compra no se edita: un error se corrige con un ajuste. Se reintenta sin duplicar por `client_uuid`. Todavía no hay pedidos a proveedores, pagos ni cuenta corriente con el proveedor.
2. **Cambios.** Un cambio es una devolución más una venta nueva en la misma transacción. Lo devuelto queda como crédito que paga primero la venta nueva, con un medio de pago interno de tipo `exchange` («Crédito por cambio»). Ese medio se crea la primera vez que se usa, no se configura, no se elige al cobrar, no mueve efectivo y no figura en cobros, rendiciones ni como cobro electrónico del día. La venta nueva guarda `exchange_return_id`. Si lo nuevo cuesta más, se cobra la diferencia con cualquier medio; si cuesta menos, se rechaza: la diferencia a favor del cliente se resuelve con una devolución. Una venta que es un cambio no se anula. El «vendido hoy» descuenta lo pagado con crédito, que ya se había cobrado en la venta original.
3. **Etiquetas.** Las variantes sin código reciben un EAN-13 interno con prefijo 29, reservado por GS1 para uso dentro del comercio, numerado por comercio bajo bloqueo. La web dibuja EAN-13 y, para otros textos, Code 128 B en SVG, sin librerías externas. Imprime en rollo de 50 × 25 mm o en hoja A4 de 24 etiquetas, con el diálogo del navegador.
4. **Catálogo de referencia por rubro.** Precios Claros (SEPA) son precios de supermercado y no traen categoría. En lugar de clasificar sus productos, el rubro define si se ofrece «Agregar desde catálogo» (`settings.referenceCatalog`), y el comercio lo puede cambiar desde Configuración.

## Verificación

Pruebas de integración con MariaDB de compras (stock, costos, permisos, reintentos), cambios (crédito, diferencia en efectivo, rechazo por menos, anulación bloqueada, caja y resumen del día), códigos internos y aislamiento de las rutas nuevas. Pruebas unitarias de la codificación EAN-13 y Code 128. Antes de usar las etiquetas en el local, probar la lectura con el lector del comercio.
