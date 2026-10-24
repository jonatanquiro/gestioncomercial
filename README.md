# Gestión Comercial

SaaS multiempresa de gestión comercial para comercios minoristas de Argentina: punto de venta, inventario, caja, compras, cuentas corrientes y factura electrónica ARCA, con venta sin conexión (PWA).

El desarrollo avanza por fases. **Estado actual: Fase 2 (infraestructura y núcleo).** Incluye registro de comercios, sesiones, recuperación de contraseña, sucursales, empleados, roles y permisos, auditoría, aislamiento entre comercios y el panel de la plataforma.

## Requisitos

- Node.js 22 (ver `.nvmrc`) y pnpm 10 (`corepack enable`)
- Docker con Docker Compose

## Levantar todo con Docker

```bash
cp .env.example .env
# Completar APP_ENCRYPTION_KEY con:  openssl rand -base64 32
docker compose up --build
```

- Aplicación: http://localhost:3000
- Correos de prueba (Mailpit): http://localhost:8025

El servicio `migrate` aplica las migraciones antes de que arranque la aplicación.

## Desarrollo con recarga en caliente

```bash
pnpm install
cp .env.example .env              # completar APP_ENCRYPTION_KEY
docker compose up -d db mailpit   # solo base y correo
pnpm build                        # compila los paquetes compartidos
pnpm db:migrate
pnpm dev:api                      # http://localhost:3000/api/v1
pnpm dev:web                      # http://localhost:5173 (redirige /api a la API)
```

### Crear un administrador de la plataforma

El panel está en `/plataforma`. Exige contraseña y código TOTP.

```bash
PLATFORM_ADMIN_PASSWORD='una-contraseña-larga' pnpm --filter @gc/api platform:create-admin vos@dominio.com "Tu nombre"
```

El comando imprime un código `otpauth://` para cargar en la app de autenticación. Con Docker: `docker compose exec -e PLATFORM_ADMIN_PASSWORD=... app node dist/scripts/create-platform-admin.js vos@dominio.com "Tu nombre"`.

## Pruebas

```bash
pnpm typecheck
pnpm test        # unitarias + integración de la API (necesita PostgreSQL con infra/postgres/init.sql aplicado)
pnpm e2e         # navegador; requiere la app levantada (ver variables al inicio de e2e/nucleo.e2e.mjs)
```

Las pruebas de la API usan la base `gestioncomercial_test`, que se recrea en cada corrida. Para apuntar a otra: `TEST_DATABASE_URL` y `TEST_DATABASE_MIGRATION_URL`.

## Variables de entorno

Están documentadas en [`.env.example`](.env.example). Nunca se sube `.env`. En producción son obligatorias `APP_ENCRYPTION_KEY`, `DATABASE_URL` y `SMTP_URL`. Las migraciones usan `DATABASE_MIGRATION_URL`, con el rol dueño.

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/api` | API NestJS + Fastify, Drizzle, migraciones en `src/db/migrations` |
| `apps/web` | Aplicación React (PWA) |
| `packages/contracts` | Esquemas Zod, permisos y tipos compartidos |
| `packages/domain` | Lógica de negocio pura (dinero, precios) |
| `infra/postgres` | Roles y bases iniciales |
| `e2e` | Prueba de punta a punta en navegador |
| `docs/adr` | Decisiones de arquitectura |

## Decisiones de arquitectura

- [0001 · Stack y estructura](docs/adr/0001-stack-y-estructura.md)
- [0002 · Aislamiento multiempresa con RLS](docs/adr/0002-aislamiento-multiempresa.md)
- [0003 · Sesiones y autenticación](docs/adr/0003-sesiones-y-autenticacion.md)
- [0004 · Estrategia de pruebas](docs/adr/0004-pruebas.md)
