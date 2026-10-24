# ADR 0002 · Aislamiento entre comercios con RLS y roles de base

**Estado:** aceptada (Fase 2).

## Decisión

1. Esquema compartido: cada tabla comercial tiene `tenant_id`, `UNIQUE (tenant_id, id)` y claves foráneas compuestas `(tenant_id, x_id)`, así una fila nunca puede apuntar a datos de otro comercio.
2. Row Level Security en todas las tablas con `tenant_id`. Las políticas comparan contra `app_current_tenant()`, que lee `set_config('app.tenant_id', …, true)` (local a la transacción).
3. Roles de base:
   - `gc_owner`: dueño de las tablas; solo corre migraciones.
   - `gc_app`: rol de conexión de la API, `NOINHERIT` y sin permisos propios.
   - `gc_tenant`, `gc_auth`, `gc_platform`: roles de grupo. Cada transacción entra a uno con `SET LOCAL ROLE` (lo hace `DbService`). Si el código olvida hacerlo, la consulta falla en lugar de devolver datos.
   - `gc_platform` no tiene permisos sobre tablas comerciales. Solo ve conteos mediante la función `platform_tenant_usage()`.
4. `audit_log` es solo de inserción: un disparador rechaza `UPDATE` y `DELETE`, incluso al dueño.

## Desvío respecto del diseño: RLS sin `FORCE`

El diseño mencionaba `FORCE ROW LEVEL SECURITY`. `FORCE` solo cambia algo para el **dueño** de la tabla. La API nunca se conecta como dueño, así que las políticas se le aplican siempre. Sin `FORCE`, las migraciones y la sincronización de catálogos (que corren como `gc_owner`) funcionan sin abrir excepciones en las políticas.

## Cómo se verifica

`apps/api/src/test/isolation.test.ts` recorre el catálogo de la base y falla si una tabla con `tenant_id` no tiene RLS. También prueba lecturas y escrituras cruzadas entre dos comercios, rutas con IDs ajenos (404) y el acceso del rol de plataforma. `permissions.test.ts` recorre todas las rutas registradas en Nest, así cada ruta nueva queda cubierta sola.
