# CLAUDE.md

Guía para trabajar en este repositorio. Todo el producto (interfaz, mensajes de error, documentación y commits) está en español rioplatense.

**El sistema tiene que correr en XAMPP:** PHP 8.2 + MariaDB 10.4 (o MySQL 8). No usar funciones posteriores a esas versiones (por ejemplo `SKIP LOCKED`). Antes de proponer otro stack o servicio, preguntarle a Jona.

## Comandos

- Servidor (`apps/server`): `composer install` · `php artisan migrate` · `php artisan serve` · `php artisan test` (usa `DB_TEST_DATABASE`) · `vendor/bin/pint`
- Web y paquetes: `pnpm build` (compila a `apps/server/public/spa`: commitear el resultado) · `pnpm typecheck` · `pnpm test` · `pnpm e2e`
- `pnpm catalog` regenera `apps/server/database/catalog.json` desde `packages/contracts` (commitearlo).

## Reglas que no se negocian

- Toda tabla comercial lleva `tenant_id`, `UNIQUE (tenant_id, id)` y FKs compuestas `(tenant_id, x_id)`, y su modelo usa el trait `BelongsToTenant`. `IsolationTest` falla si falta.
- El comercio activo sale de la sesión (`TenantContext`), nunca del pedido. No se consultan tablas comerciales con `DB::table`/`DB::select` ni se saltea el scope (`withoutGlobalScope`, `withoutTenant`) fuera de los archivos permitidos en `IsolationTest`.
- Por defecto, toda ruta de `routes/api.php` exige sesión y CSRF en las mutaciones. Las rutas públicas llevan nombre `public.*`. Las rutas sobre datos del comercio declaran `perm:...` con códigos de `packages/contracts/src/permissions.ts`. `PermissionsTest` recorre todas las rutas.
- Los cambios sensibles registran auditoría (`AuditService::record`) dentro de la misma `DB::transaction`.
- Los errores salen con el formato `{ code, message, details, requestId }` (`AppError` y `App\Http\ErrorRenderer`).
- Las validaciones del servidor (`App\Support\Input`) repiten los límites y mensajes de los esquemas Zod de `packages/contracts`, que usa la web. Si se cambia uno, se cambia el otro.
- El dinero se maneja con `packages/domain/src/money.ts` en la web y con `brick/math` en PHP. Nunca con float.
- No hay persistencia simulada en memoria ni respuestas inventadas de servicios externos. Las pruebas corren contra MySQL real.
- La interfaz no muestra botones sin funcionalidad. Un módulo aparece en el menú solo cuando existe.
- No se exponen credenciales. Los secretos van en variables de entorno, documentadas en `apps/server/.env.example`.
- Antes de cambiar una decisión de arquitectura, se explica el motivo en `docs/adr`.
