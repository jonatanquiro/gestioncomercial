# ADR 0001 · Stack y estructura del repositorio

**Estado:** reemplazada por [0005](0005-php-mysql-xampp.md) el 2026-10-25. Jona necesita que el sistema corra en PHP + MySQL (XAMPP); este stack nunca fue un requisito suyo.

## Decisión

Monolito modular en TypeScript, en un monorepo pnpm:

| Carpeta | Contenido |
|---|---|
| `apps/api` | NestJS 11 sobre Fastify 5, Drizzle ORM, PostgreSQL 17 |
| `apps/web` | React 19, Vite 8, Tailwind 4, TanStack Router y Query, react-hook-form |
| `packages/contracts` | Esquemas Zod, catálogo de permisos, plantillas de roles y tipos de la API, compartidos por web y API |
| `packages/domain` | Lógica pura sin E/S (dinero con decimal.js, precios y márgenes) |

Todas las versiones están fijadas exactas en los `package.json`.

## Desvíos respecto del diseño, y por qué

- **La API sirve la web compilada** (variable `WEB_DIST_DIR`) en lugar de publicar los estáticos en un CDN. Así hay una sola imagen y un solo origen, y no hace falta configurar CORS ni cookies entre dominios. Poner un CDN delante más adelante no cambia el código.
- **pg-boss todavía no está instalado.** La Fase 2 no tiene trabajos en segundo plano: los correos se envían en línea. Entra cuando aparezcan los primeros trabajos (ARCA, reportes).
