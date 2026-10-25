# ADR 0004 · Estrategia de pruebas

**Estado:** aceptada (Fase 2) · **Actualizada** el 2026-10-25 para Laravel ([0005](0005-php-mysql-xampp.md)).

## Decisión

- **Unitarias** con Vitest: `packages/contracts` (CUIT), `packages/domain` (dinero y precios) y `apps/web` (cliente de la API).
- **Integración de la API** con PHPUnit contra MySQL/MariaDB real (base `DB_TEST_DATABASE`, nunca la de trabajo). Se migra una vez por corrida y cada prueba crea comercios con datos únicos. Los límites del plan ante altas simultáneas se prueban con pedidos paralelos de verdad contra un `php -S` con varios procesos.
- **CI** con PHP 8.2 y MariaDB 10.4, las versiones de XAMPP 8.2. También se corrió la suite completa contra MySQL 8.0.
- **E2E en navegador** con Playwright (`e2e/nucleo.e2e.mjs`) contra una instancia levantada: registro, alta de empleado, permisos, auditoría, recuperación por correo (Mailpit) y suspensión desde la plataforma.

## Desvío respecto del diseño: sin Testcontainers

El diseño proponía Testcontainers. Las pruebas usan en cambio un PostgreSQL ya levantado (el servicio de GitHub Actions, o `docker compose up db` en local), que se indica por variables de entorno. La cobertura es la misma, porque igual es PostgreSQL 17 real con RLS. Así se evita depender del socket de Docker dentro del proceso de pruebas, que no está disponible en todos los entornos de CI.
