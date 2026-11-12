# ADR 0025 · Variantes en todos los planes y CUIT compartido por el mismo dueño

**Estado:** aceptada el 2026-11-12.

## Contexto

- **Variantes según el plan:** los talles y colores estaban solo en los planes Multisucursal y Avanzado. Una tienda de ropa o de calzado con plan Inicial o Profesional no podía cargarlos, y para esos rubros son indispensables.
- **Un CUIT por comercio:** un índice único no dejaba usar el mismo CUIT en dos comercios. Pero un mismo dueño puede tener, por ejemplo, una despensa y una tienda de ropa, y facturar las dos con su CUIT, cada una con su punto de venta.

## Decisiones

1. **Variantes en todos los planes.**
   - Los planes iniciales incluyen la función `variants`.
   - Una migración se la suma a los planes que ya existen.
   - Desde el panel de plataforma se puede quitar a un plan, como cualquier otra función.
2. **CUIT compartido solo entre comercios del mismo dueño.**
   - Se quita el índice único `tenants_cuit_active_uq` y la regla pasa a `TenantCuitGuard`.
   - Un CUIT puede repetirse solo si una misma persona es dueña (rol del sistema «owner», activa) de todos los comercios no dados de baja que lo usan.
   - Si el CUIT es de otra persona, se rechaza con `CUIT_TAKEN`.
   - Se controla al registrarse, al dar de alta desde la plataforma y al cambiarlo en los datos del comercio.
   - La consulta de dueños entre comercios está en `AuthService::ownsAll`, que ya podía consultar membresías por persona (ver `IsolationTest`).

## Límites conocidos

- **Altas simultáneas:** sin el índice único, dos altas al mismo tiempo de personas distintas con el mismo CUIT podrían pasar las dos. Es muy poco probable, y queda en la auditoría para corregirlo desde la plataforma.

## Verificación

- **Pruebas de integración:**
  - otra persona no puede registrar ni cargar el CUIT;
  - la plataforma da de alta un segundo comercio del mismo dueño con su CUIT;
  - el dueño lo cambia y lo vuelve a poner;
  - un comercio nuevo tiene variantes.
