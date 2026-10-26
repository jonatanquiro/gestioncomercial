# ADR 0004 · Estrategia de pruebas

**Estado:** aceptada (Fase 2) · **Actualizada** el 2026-10-25 para Laravel ([0005](0005-php-mysql-xampp.md)).

## Decisión

- **Unitarias** con Vitest: `packages/contracts` (CUIT), `packages/domain` (dinero y precios) y `apps/web` (cliente de la API).
- **Integración de la API** con PHPUnit contra MySQL/MariaDB real (base `DB_TEST_DATABASE`, nunca la de trabajo). Se migra una vez por corrida y cada prueba crea comercios con datos únicos. Los límites del plan ante altas simultáneas se prueban con pedidos paralelos de verdad contra un `php -S` con varios procesos.
- **CI** con PHP 8.2 y MariaDB 10.4, las versiones de XAMPP 8.2. También se corrió la suite completa contra MySQL 8.0.
- **E2E en navegador** con Playwright (`e2e/nucleo.e2e.mjs`) contra una instancia levantada: registro, alta de empleado, permisos, auditoría, recuperación por correo (Mailpit) y suspensión desde la plataforma.

## Desvío respecto del diseño: sin Testcontainers

El diseño original proponía Testcontainers para PostgreSQL. Desde la migración a Laravel ([0005](0005-php-mysql-xampp.md)), las pruebas usan MySQL/MariaDB ya levantado: el servicio de CI o MySQL de XAMPP en local. La conexión se indica por variables de entorno y la base de pruebas se selecciona con `DB_TEST_DATABASE`. Así se evita depender del socket de Docker dentro del proceso de pruebas. El aislamiento se verifica con los controles de aplicación y claves compuestas descritos en [0006](0006-aislamiento-sin-rls.md).
