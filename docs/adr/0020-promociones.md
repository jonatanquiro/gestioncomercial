# ADR 0020 · Promociones

**Estado:** aceptada el 2026-11-04.

## Contexto

Las promociones figuraban como funcionalidad de los planes Profesional en adelante, pero no existían. Los comercios de ropa las usan todo el tiempo: un porcentaje sobre una categoría o un 2×1. Si el cajero las calcula a mano, hay errores y discusiones en el mostrador.

## Decisiones

1. **Dos tipos de promoción.**
   - **Porcentaje de descuento.**
   - **N×M:** lleva N y paga M. Las unidades que no se pagan son las más baratas entre todas las que entran en la promoción, aunque estén en líneas distintas. Solo cuenta unidades enteras de artículos que se venden por unidad.
2. **Alcance:** todo el comercio, una categoría o un producto (con todos sus talles y colores). Puede tener fechas de inicio y fin, ambas inclusive, en hora de Argentina, y se puede pausar.
3. **Sin acumular.**
   - **Una promoción por línea:** cada línea recibe a lo sumo una, la que más le descuenta.
   - **Descuento manual:** una línea con descuento manual no recibe promociones.
   - **Porcentaje y N×M:** una línea con porcentaje no suma unidades para un N×M, así una misma unidad no da dos beneficios.
4. **Las calcula el servidor.** `SalesService::price` calcula precios y promociones, y lo usan tanto la venta como la cotización (`POST /sales/quote`). Cuando hay promociones vigentes, la caja muestra el total cotizado y lo manda como `expectedTotal`, así lo que ve el cajero es lo que se cobra. Si una promoción cambia en el medio, la venta responde «cambió el precio» y la caja vuelve a cotizar.
5. **Registro en la venta.** La línea guarda la promoción (`promotion_id`) y cuánto descontó (`promotion_discount`). El `line_total` ya la descuenta, así las devoluciones, la factura y los reportes usan el importe real. El ticket y el detalle de la venta muestran el nombre de la promoción.
6. **Un cambio no aplica promociones:** lo que se lleva va a precio de lista, porque el crédito ya viene de una venta.
7. **Plan y permisos.** Se respeta el plan: sin la funcionalidad `promotions`, no se crean ni se aplican. Las administra quien tiene `promotions.manage`. El cajero solo cotiza.

## Límites conocidos

- **Descuento por medio de pago:** por ejemplo, 10% pagando en efectivo. No está incluido, porque el total dependería de cómo se cobra y eso cambia el circuito de cobro.

## Verificación

- **Pruebas de integración con MariaDB:**
  - porcentaje por categoría;
  - 3×2 con la unidad más barata gratis;
  - sin acumular con el descuento manual ni entre promociones;
  - total cotizado igual al cobrado, y «cambió el precio» con el total sin promoción;
  - vigencia, pausa y plan;
  - permisos del cajero;
  - aislamiento entre comercios.
- **Recorrido en el navegador:** alta de promociones y venta con las dos aplicadas.
