# ADR 0003 · Sesiones con cookie y autenticación

**Estado:** aceptada (Fase 2) · **Actualizada** el 2026-10-25 para Laravel ([0005](0005-php-mysql-xampp.md)): mismas decisiones, otra implementación.

## Decisión

- **Sesiones opacas en base de datos**, no JWT. La cookie `gc_session` (httpOnly, SameSite=Lax, Secure en producción) lleva un token aleatorio. La base guarda solo su hash SHA-256. Así cerrar una sesión o todas tiene efecto inmediato.
  - Comercios: 12 h de inactividad y 30 días como máximo.
  - Plataforma (`gc_psession`): 2 h de inactividad y 12 h como máximo.
- **CSRF de doble envío.** Toda mutación exige que el encabezado `x-csrf-token` coincida con la cookie `gc_csrf`.
- **Contraseñas** con Argon2id (parámetros OWASP), un mínimo de 10 caracteres y una lista de contraseñas comunes.
- **Bloqueo por intentos fallidos** por IP y por email.
- **Administradores de plataforma** con email y contraseña. El TOTP obligatorio se quitó a pedido de Jona (ver `0007-plataforma-sin-totp.md`).
- **Recuperación de contraseña** con un token de un solo uso que vence en 30 minutos. Al usarlo se cierran todas las sesiones. La respuesta es la misma exista o no el email.

## Pendiente

- MFA opcional para dueños de comercio.
- ~~El limitador de intentos vive en memoria del proceso.~~ Resuelto en Laravel: usa la caché en la base (`CACHE_STORE=database`), así funciona con varias instancias.
- La sesión web de Laravel no se usa (`SESSION_DRIVER=array`): las sesiones son las propias, en `user_sessions` y `platform_sessions`.
