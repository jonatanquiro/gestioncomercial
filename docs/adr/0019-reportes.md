# ADR 0019 · Reportes

**Estado:** aceptada el 2026-11-04.

## Contexto

Solo existía el resumen del día del inicio. Para decidir qué comprar, qué liquidar y cómo le va al negocio hacían falta reportes de un período: qué se vendió, por talle, por vendedor, con qué se cobró, cuánto se ganó y qué no rota.

## Decisiones

1. **Qué se cuenta.** Solo las ventas de mercadería confirmadas (`sales.kind = sale`), netas de devoluciones. La venta de gift cards y los cobros de cuenta corriente no son ventas de mercadería. La devolución se descuenta en la fecha de la venta original, así el reporte de un período no cambia de signo.
2. **Agrupaciones.** Las consultas agregan en la base, con el filtro por comercio de los modelos. El período puede ser de hasta un año, en hora de Argentina, y se puede filtrar por sucursal.
   - **Por producto, por variante y por categoría:** cantidad e importe neto. La de variantes muestra el stock actual, para ver qué talles se agotan.
   - **Por día y por vendedor:** cantidad de ventas e importe neto.
   - **Por medio de pago:** lo cobrado, ya descontado el vuelto.
3. **Margen.** Usa el costo congelado en cada línea de venta y muestra cuántas líneas no tenían costo, porque su margen sale más alto. Se ve con el permiso `reports.profit` y con un plan que incluya `advanced_reports`: el plan se respeta, como con las variantes. El resto de los reportes está en todos los planes, con `reports.sales`.
4. **Sin rotación.** Lista las variantes activas con stock y sin ventas en los últimos 30, 60, 90 o 180 días, con su última venta. Con margen habilitado, también muestra el valor inmovilizado al costo.
5. **Exportación.** CSV generado en el navegador con separador «;» y BOM, para que Excel en español lo abra bien. Requiere `reports.export`.

## Verificación

- **Pruebas de integración con MariaDB:**
  - totales netos de devoluciones, sin la venta de gift cards;
  - cada agrupación;
  - margen visible solo con el plan y el permiso;
  - el cajero sin acceso;
  - sin rotación;
  - aislamiento entre comercios.
- **Recorrido en el navegador** de las dos pestañas.
