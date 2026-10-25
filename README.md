# Gestión Comercial

SaaS multiempresa de gestión comercial para comercios minoristas de Argentina: punto de venta, inventario, caja, compras, cuentas corrientes y factura electrónica ARCA, con venta sin conexión (PWA).

El desarrollo avanza por fases. **Estado actual: Fase 3 (productos e inventario), en PHP + MySQL.** Incluye:
- registro de comercios, sesiones y recuperación de contraseña;
- sucursales, empleados, roles y permisos;
- auditoría y aislamiento entre comercios;
- el panel de la plataforma;
- productos y servicios con varios códigos de barras y códigos de pack, categorías iniciales según el rubro, marcas e historial de precios y costos;
- stock por depósito con movimientos inalterables, ajustes, mermas y vencimientos con motivo, alerta de stock mínimo e inventario físico;
- cambio masivo de precios con vista previa exacta, recargo sobre costo o margen sobre precio y redondeo.

Si ya tenías instalada una versión anterior, después de actualizar el código corré `php artisan migrate`: crea las tablas nuevas y les carga a los comercios existentes las categorías de su rubro.

## Requisitos

- **XAMPP 8.2** (PHP 8.2 + MariaDB), o cualquier PHP 8.2+ con MySQL 8 o MariaDB 10.4+
- **Composer 2** (https://getcomposer.org)
- Node.js **no** hace falta para usar el sistema: la web ya viene compilada en `apps/server/public/spa`. Solo se necesita para modificar las pantallas.

## Actualizar y arrancar con un doble clic (Windows)

`iniciar.bat` hace todo solo: baja la última versión desde GitHub (la primera vez clona el repositorio), corre `composer install`, crea `.env` si no existe, actualiza la base con `php artisan migrate` y levanta el sistema en http://localhost:8000 abriendo el navegador. Necesita Git para Windows, Composer y MySQL iniciado en el panel de XAMPP. Se puede dejar dentro de la carpeta del repositorio o en la carpeta que lo contiene (por ejemplo `C:\xampp\htdocs`). Descarta cambios hechos a mano en el código; `.env` no se toca.

## Instalar en XAMPP (Windows)

1. Iniciar **Apache** y **MySQL** desde el panel de XAMPP.
2. En phpMyAdmin (http://localhost/phpmyadmin) crear la base `gestioncomercial` con cotejamiento `utf8mb4_unicode_ci`. Para las pruebas automáticas, crear también `gestioncomercial_test`.
3. En una consola, dentro de la carpeta del repositorio:

   ```bash
   cd apps/server
   composer install
   copy .env.example .env        # en Linux o macOS: cp .env.example .env
   php artisan key:generate
   php artisan migrate
   ```

   `.env.example` ya trae la configuración de XAMPP: usuario `root` sin contraseña. `migrate` crea las tablas y carga permisos, rubros y planes.
   Si tu MySQL tiene contraseña para `root` (el error dice `Access denied for user 'root'@'localhost' (using password: NO)`), ponela en `DB_PASSWORD` dentro de `.env` y volvé a correr `migrate`. Si ya estaba andando `php artisan serve`, reinicialo. Si en la PC hay otro MySQL instalado aparte de XAMPP (por ejemplo el servicio "MySQL80"), el de XAMPP suele quedar en otro puerto, como el 3307: fijate cuál usa phpMyAdmin y ponelo en `DB_PORT`.

4. Levantar el sistema:

   ```bash
   php artisan serve
   ```

   Entrar a **http://localhost:8000** y registrar un comercio.

Si Composer avisa que falta una extensión de PHP (por ejemplo `fileinfo` o `zip`), activarla quitando el `;` de su línea en `C:\xampp\php\php.ini` y reiniciar la consola.

### Con Apache de XAMPP, sin `php artisan serve`

La aplicación tiene que quedar en la **raíz** de un sitio, no en una subcarpeta como `http://localhost/gestioncomercial`. Agregar un VirtualHost en `C:\xampp\apache\conf\extra\httpd-vhosts.conf`:

```apache
Listen 8080
<VirtualHost *:8080>
    DocumentRoot "C:/xampp/htdocs/gestioncomercial/apps/server/public"
    <Directory "C:/xampp/htdocs/gestioncomercial/apps/server/public">
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

Reiniciar Apache, poner `APP_URL=http://localhost:8080` en `.env` y entrar a http://localhost:8080.

### Correos

Con `MAIL_MAILER=log`, los correos (por ejemplo, el de recuperación de contraseña) se escriben en `apps/server/storage/logs/laravel.log`. Para verlos como correo real se puede usar Mailpit, configurando `MAIL_MAILER=smtp`, `MAIL_HOST=127.0.0.1` y `MAIL_PORT=1025`.

### Crear un operador del panel de plataforma

El panel está en `/plataforma`. Se entra con el email y la contraseña del operador.

```bash
cd apps/server
php artisan platform:create-admin vos@dominio.com "Tu nombre"
```

El comando pide la contraseña (mínimo 10 caracteres).

Desde el panel se pueden dar de alta comercios a mano (botón **Nuevo comercio**): se elige rubro y plan, y el dueño recibe un correo con un enlace para elegir su contraseña (vence en 7 días). Si ese email ya tenía cuenta, el comercio se suma a los suyos y entra con su contraseña de siempre.

## Pruebas

```bash
cd apps/server && php artisan test   # PHPUnit contra la base gestioncomercial_test (se recrea en cada corrida)
pnpm typecheck && pnpm test          # web y paquetes compartidos
pnpm e2e                             # navegador; requiere el sistema levantado (ver el inicio de e2e/nucleo.e2e.mjs)
```

Las pruebas de PHP nunca tocan la base de trabajo: con `APP_ENV=testing` usan siempre `DB_TEST_DATABASE`.

## Modificar las pantallas (requiere Node 22 y pnpm 10)

```bash
pnpm install
pnpm dev:web      # http://localhost:5173, redirige /api a php artisan serve (puerto 8000)
pnpm build        # compila a apps/server/public/spa: hay que commitear el resultado
```

Los permisos, roles plantilla y rubros se definen una sola vez en `packages/contracts`. Después de cambiarlos, correr `pnpm catalog`. Eso regenera `apps/server/database/catalog.json`, que hay que commitear. CI verifica que la web compilada y el catálogo estén al día.

## Variables de entorno

Están documentadas en [`apps/server/.env.example`](apps/server/.env.example). Nunca se sube `.env`. En producción:
- `APP_KEY` propia;
- `APP_DEBUG=false`;
- `SESSION_SECURE_COOKIE=true` con HTTPS;
- un usuario de base con contraseña;
- un servidor de correo real.

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/server` | Laravel 12: API `/api/v1`, migraciones, pruebas y la web compilada (`public/spa`) |
| `apps/web` | Pantallas en React (PWA) |
| `packages/contracts` | Esquemas, permisos, roles y rubros compartidos (fuente de `catalog.json`) |
| `packages/domain` | Lógica pura de la web (dinero, precios) |
| `e2e` | Prueba de punta a punta en navegador |
| `docs/adr` | Decisiones de arquitectura |

## Decisiones de arquitectura

- [0005 · PHP + MySQL compatible con XAMPP (Laravel 12)](docs/adr/0005-php-mysql-xampp.md)
- [0006 · Aislamiento entre comercios en MySQL](docs/adr/0006-aislamiento-sin-rls.md)
- [0003 · Sesiones y autenticación](docs/adr/0003-sesiones-y-autenticacion.md)
- [0004 · Estrategia de pruebas](docs/adr/0004-pruebas.md)
- Históricas: [0001](docs/adr/0001-stack-y-estructura.md) y [0002](docs/adr/0002-aislamiento-multiempresa.md), del stack anterior en Node y PostgreSQL
