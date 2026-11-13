# ADR 0012 · Cobro de suscripciones con Mercado Pago

**Estado:** aceptada el 2026-10-29.

## Motivo

Hasta ahora la suscripción guardaba un fin de prueba que nada controlaba: un comercio seguía operando para siempre salvo que alguien lo suspendiera a mano, y no había forma de cobrar. Jona quiere cobrar el uso sin tener que estar pendiente: que el comercio pague solo, que el sistema avise por correo antes de vencer y que corte el acceso si no se paga. También quiere poder dar licencias sin vencimiento.

## Decisión

- **Pago por adelantado con Checkout Pro**, igual que en Celenial y gestion-silvia: el dueño elige plan y cantidad de meses (1, 3, 6 o 12), paga en Mercado Pago y el período se corre cuando Mercado Pago confirma el pago. No se usan débitos automáticos (preapproval): la cuenta de Mercado Pago ya opera con Checkout Pro y así cada pago es una operación que se puede revisar y reembolsar.
- **Lo que vale es lo que dice Mercado Pago.** El aviso automático (webhook) y la vuelta del navegador solo traen el número de pago; el sistema siempre consulta el pago a la API. Se acepta si está aprobado, en pesos y por el importe pedido. La referencia externa lleva el prefijo `GC-`, el comercio y el pago (`GC-<comercio>_<pago>`), para no confundirse con cobros de otros sistemas en la misma cuenta y para atender el aviso sin consultar fuera del comercio.
- **Estado calculado**, no guardado: con el fin de prueba, el fin del período pagado y la licencia se deriva `free` (sin vencimiento), `trial`, `active`, `grace` (vencida, con 7 días para pagar) o `expired`. En `expired` la API responde `402 SUBSCRIPTION_EXPIRED` a todo salvo la sesión y la pantalla de suscripción; los datos no se tocan.
- **Sin cobro** para los comercios con licencia sin vencimiento (la marca el operador desde el panel, con motivo y auditoría) y para los planes con precio 0.
- **Avisos por correo** con `php artisan subscriptions:remind`, una vez por día desde el cron del hosting: 7, 3 y 1 día antes del vencimiento, el día que vence y cuando se pausa. Cada aviso se manda una sola vez por vencimiento. El mismo comando revisa en Mercado Pago los pagos pendientes de los últimos días, por si se perdió un aviso.
- El operador puede registrar a mano un pago recibido por otro medio (transferencia), que corre el período igual que un pago de Mercado Pago.

## Consecuencias

- Las credenciales van en `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` (`.env`). Sin token, la pantalla de suscripción muestra el estado pero no ofrece pagar.
- El webhook es una ruta pública más (`public.mercadopago-webhook`), con límite de pedidos por IP; si llega una firma y hay clave configurada, se verifica.
- Si el cron no corre, no salen los correos, pero el corte de acceso funciona igual porque se calcula en cada pedido.
- Al poner precio a un plan, los comercios de ese plan que ya pasaron la prueba entran en gracia o quedan pausados. Antes de cargar precios hay que marcar las licencias sin vencimiento.
- Las pruebas simulan la API de Mercado Pago con `Http::fake`, como con ARCA ([0004](0004-pruebas.md)).
