# ADR 0021 · Envío de comprobantes al cliente

**Estado:** aceptada el 2026-11-04.

## Contexto

Al terminar una venta, el cajero no tenía un aviso claro de que se había registrado ni del vuelto. Además, muchos clientes prefieren el comprobante en el celular antes que en papel. La API de WhatsApp Business se cobra por mensaje, y eso no tiene sentido para un comercio chico.

## Decisiones

1. **Aviso de venta cobrada en el lugar del carrito.** No es una ventana modal: el lector de códigos sigue activo, y escanear el próximo artículo arranca la venta siguiente.
   - Muestra el total, el vuelto bien grande y las acciones: imprimir, ticket de cambio, facturar y enviar.
2. **Email desde el servidor** (`POST /sales/{id}/email`).
   - **Contenido:** manda el ticket o, con permiso fiscal, la factura autorizada, con el enlace de consulta de ARCA (el mismo del QR).
   - **Remitente:** sale desde la casilla del sistema, con el nombre del comercio como remitente. Si el comercio cargó su email, las respuestas le llegan a él.
   - **Email del cliente:** no queda en la venta. Se guarda en la ficha del cliente solo si se marca la opción y quien envía tiene `customers.manage`.
   - **Auditoría:** queda registrado el envío (`sale.emailed`).
   - **Límite:** 150 envíos por hora por comercio, para que nadie use el sistema para mandar correo masivo.
3. **WhatsApp sin API paga.** Se abre `wa.me` con el comprobante escrito, y el cajero lo manda desde su propia cuenta. Si no se carga el número, WhatsApp deja elegir el contacto.
4. **El ticket no fiscal no imprime el email** ni otros datos del cliente que no correspondan.

## Límites conocidos

- **Sin PDF adjunto:** la factura va en el cuerpo del email con su CAE y el enlace de ARCA. El QR en imagen sale solo en la impresión.
- **WhatsApp manual:** depende de que el equipo tenga WhatsApp Web o la aplicación instalada.

## Verificación

- **Pruebas de integración:**
  - envío del ticket;
  - validación del email;
  - el email se guarda en la ficha solo si se pide;
  - auditoría;
  - factura ajena;
  - el cajero solo puede mandar sus ventas;
  - aislamiento entre comercios.
- **Recorrido en el navegador:** venta, envío y paso a la venta siguiente escaneando.
