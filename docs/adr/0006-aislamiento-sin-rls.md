# ADR 0006 · Aislamiento entre comercios en MySQL (sin RLS)

**Estado:** aceptada el 2026-10-25 · **Reemplaza a:** [0002](0002-aislamiento-multiempresa.md).

## Motivo

MySQL y MariaDB no tienen Row Level Security. Tampoco permiten cambiar de rol por transacción como hacía `DbService` en PostgreSQL. El aislamiento pasa a la aplicación, con varias capas que se controlan entre sí.

## Decisión

1. **Esquema compartido igual que antes.** Cada tabla comercial tiene `tenant_id`, `UNIQUE (tenant_id, id)` y FKs compuestas `(tenant_id, x_id)`. La base rechaza (error 1452) que una fila apunte a datos de otro comercio, aunque el código se equivoque. La API responde 404.
2. **Filtro automático en los modelos.** El trait `BelongsToTenant` agrega un scope global con el comercio de `TenantContext`. Al crear una fila completa `tenant_id` y rechaza uno distinto. Al editar, impide cambiarlo.
3. **Falla cerrado.** Sin comercio en contexto, consultar un modelo comercial lanza `MissingTenantContext` en lugar de devolver todas las filas.
4. **El comercio sale de la sesión**, nunca del pedido. Lo fija `AuthenticateUser`, y cada request arranca con el contexto vacío.
5. **Saltear el filtro está acotado.** Solo pueden hacerlo el panel de plataforma (`TenantContext::withoutTenant`), las membresías del propio usuario (siempre por `user_id`) y los catálogos globales. Una prueba recorre `app/` y falla si aparece `withoutGlobalScope`, `DB::table`, `DB::select`, etc. fuera de esos archivos.
6. **La auditoría no se puede modificar.** Disparadores en `audit_log` rechazan `UPDATE` y `DELETE`, también desde phpMyAdmin.

## Qué se pierde respecto de RLS, y cómo se compensa

Con RLS, una consulta SQL escrita a mano sin filtro igual quedaba limitada por la base. Acá no: la protegen el scope y la prueba estática que prohíbe consultas crudas fuera de los archivos permitidos. Las FKs compuestas siguen impidiendo en la base las referencias cruzadas.

## Cómo se verifica

`tests/Feature/IsolationTest.php`:
- Toda tabla con `tenant_id` tiene un modelo con `BelongsToTenant` y `UNIQUE (tenant_id, id)`.
- Toda ruta con identificador responde 404 ante un ID de otro comercio. Una ruta nueva que no se sume a la prueba la hace fallar.
- Hay lecturas y escrituras cruzadas, FKs compuestas, la consulta sin contexto y la prueba estática del código.

`PermissionsTest.php` recorre todas las rutas registradas: toda ruta no pública da 401 sin sesión, y toda ruta con permiso da 403 a un rol sin permisos.
