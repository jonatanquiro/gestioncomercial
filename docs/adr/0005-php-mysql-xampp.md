# ADR 0005 · PHP + MySQL compatible con XAMPP (Laravel 12)

**Estado:** aceptada el 2026-10-25 · **Reemplaza a:** [0001](0001-stack-y-estructura.md).

## Motivo

Jona necesita que el sistema corra en PHP + MySQL, en XAMPP. El stack anterior (Node, NestJS y PostgreSQL) se había propuesto en el diseño, pero nunca fue un requisito suyo. Jona confirmó: *"mientras uses PHP para correr en XAMPP, no importa cómo"*.

## Decisión

| Carpeta | Contenido |
|---|---|
| `apps/server` | Laravel 12 (PHP 8.2+), API `/api/v1` y web compilada en `public/spa` |
| `apps/web` | React 19 + Vite. Se compila a `apps/server/public/spa`, y esa carpeta se versiona |
| `packages/contracts` | Esquemas Zod, permisos, roles y rubros. **Fuente única** de los catálogos: `pnpm catalog` genera `apps/server/database/catalog.json` |
| `packages/domain` | Lógica pura de la web (dinero con decimal.js) |

- **Laravel 12** porque corre en el PHP 8.2 de XAMPP y trae migraciones, validación, correo, caché en base y pruebas.
- **MySQL o MariaDB.** CI usa MariaDB 10.4 (la de XAMPP) y la suite también pasa en MySQL 8.0. No se usan funciones posteriores a 10.4, como `SKIP LOCKED`.
- **Mismo contrato HTTP** que la versión anterior: rutas, cookies `gc_session`, `gc_psession` y `gc_csrf`, encabezado `x-csrf-token`, errores `{ code, message, details, requestId }` y validaciones `[{ path, message }]`. Por eso las pantallas React y la prueba E2E no cambiaron.
- **La web compilada se versiona.** Así XAMPP no necesita Node: alcanza con Composer. CI falla si `public/spa` o `catalog.json` quedan desactualizados.
- **UUID v7** como CHAR(36) (`HasUuids`) y fechas `DATETIME(6)` en UTC.

## Consecuencias

- Las validaciones se escriben dos veces: Zod en la web y reglas de Laravel en el servidor, con los mismos límites y mensajes. Las pruebas de PHPUnit cubren las del servidor, que son las que mandan.
- El cálculo de dinero del servidor (Fase 3 en adelante) usará `brick/math`, que viene con Laravel, con las mismas reglas que `packages/domain`. Se agregarán pruebas con los mismos casos en ambos lados.
- El aislamiento entre comercios se hace sin RLS ([0006](0006-aislamiento-sin-rls.md)).
