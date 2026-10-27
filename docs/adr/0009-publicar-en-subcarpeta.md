# ADR 0009 · Publicar en la raíz o en una subcarpeta

**Estado:** aceptada el 2026-10-27.

## Motivo

Jona va a publicar el sistema en `https://celenial.com.ar/gestion-comercial`, al lado de otros servicios del mismo dominio (`/invitaciones`, `/gestion-inmobiliaria`). Hasta ahora la web pedía todo desde la raíz (`/spa/...`, `/api/v1`, `/app`) y el README decía que el sistema tenía que quedar en la raíz de un sitio. Jona eligió adaptar el código en lugar de usar un subdominio.

## Decisión

- **Una sola compilación para la raíz y para una subcarpeta.** Vite compila con `base: './'`: el CSS encuentra las fuentes al lado suyo y `index.html` sale con rutas relativas.
- **Laravel completa la ruta base** al servir `index.html` (`routes/web.php`): reemplaza `./` por `<base>/spa/` y llena `<meta name="gc-base">` con `Request::getBasePath()` (`''` en la raíz, `/gestion-comercial` en la subcarpeta). No hay que configurar nada: sale de dónde está `index.php`.
- **La web lee esa ruta una vez** (`apps/web/src/lib/base.ts`) y la usa en el router (`basepath`), en la API (`<base>/api/v1`) y en los archivos de `public/spa` (`assetUrl`). El manifest usa `start_url: "../app"`, relativo a `spa/`.
- **Cookies limitadas a la carpeta** (`Cookies::path()`): `/` en la raíz, `/gestion-comercial/` en la subcarpeta, para no mezclarse con otros sistemas del dominio.
- **`public/index.php` puede vivir separado del resto.** Si al lado hay un `sistema.php`, toma de ahí la ruta del sistema y fija `public_path` en su propia carpeta. Así en un hosting compartido el código, `vendor/` y `.env` quedan fuera de `public_html`.

## Consecuencias

- En la PC todo sigue igual (`php artisan serve`, VirtualHost de XAMPP, `iniciar.bat`).
- `import.meta.env.BASE_URL` vale `./`: para un archivo de `public/spa` hay que usar `assetUrl()`, y para una dirección del sistema, `BASE_PATH` o el router.
- Los enlaces de los correos siguen saliendo de `APP_URL`, que en la subcarpeta tiene que incluirla.
