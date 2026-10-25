# ADR 0004 · Estrategia de pruebas

**Estado:** aceptada (Fase 2).

## Decisión

- **Unitarias** con Vitest: `packages/contracts` (CUIT), `packages/domain` (dinero y precios) y `apps/web` (cliente de la API).
- **Integración de la API** contra PostgreSQL real, con la aplicación Nest completa y peticiones HTTP inyectadas. El `global-setup` recrea el esquema de `gestioncomercial_test` y aplica todas las migraciones.
- **E2E en navegador** con Playwright (`e2e/nucleo.e2e.mjs`) contra una instancia levantada: registro, alta de empleado, permisos, auditoría, recuperación por correo (Mailpit) y suspensión desde la plataforma.

## Desvío respecto del diseño: sin Testcontainers

El diseño proponía Testcontainers. Las pruebas usan en cambio un PostgreSQL ya levantado (el servicio de GitHub Actions, o `docker compose up db` en local), que se indica por variables de entorno. La cobertura es la misma, porque igual es PostgreSQL 17 real con RLS. Así se evita depender del socket de Docker dentro del proceso de pruebas, que no está disponible en todos los entornos de CI.
