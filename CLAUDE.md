# CLAUDE.md

Guía para trabajar en este repositorio. Todo el producto (interfaz, mensajes de error, documentación y commits) está en español rioplatense.

## Comandos

- `pnpm build` · `pnpm typecheck` · `pnpm test` (requiere PostgreSQL con `infra/postgres/init.sql`) · `pnpm e2e`
- `pnpm db:generate` genera una migración desde `apps/api/src/db/schema.ts`. Las políticas RLS, grants y disparadores van en migraciones SQL escritas a mano.

## Reglas que no se negocian

- Toda tabla comercial lleva `tenant_id`, `UNIQUE (tenant_id, id)`, FKs compuestas y una política RLS en la misma migración. `isolation.test.ts` falla si falta.
- El acceso a datos pasa siempre por `DbService.tenant/user/auth/platform`, que entra al rol de base correspondiente. Nunca se consulta con el pool directo.
- Por defecto, todo endpoint exige sesión y CSRF en las mutaciones (guard global). `@Public()` es la excepción explícita. Los endpoints sobre datos del comercio declaran `@RequirePermission(...)`, cuyos códigos viven en `packages/contracts/src/permissions.ts`. `permissions.test.ts` recorre todas las rutas.
- Los cambios sensibles registran auditoría (`AuditService.record`) en la misma transacción.
- Los errores salen con el formato `{ code, message, details, requestId }` (`common/errors.ts`).
- Las validaciones se definen una vez con Zod en `packages/contracts` y se usan en la web y en la API.
- El dinero se maneja con `packages/domain/src/money.ts` (decimal.js). Nunca con `number`.
- No hay persistencia simulada en memoria ni respuestas inventadas de servicios externos.
- La interfaz no muestra botones sin funcionalidad. Un módulo aparece en el menú solo cuando existe.
- No se exponen credenciales. Los secretos van en variables de entorno, documentadas en `.env.example`.
- Antes de cambiar una decisión de arquitectura, se explica el motivo en `docs/adr`.
