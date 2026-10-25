# ADR 0003 · Sesiones con cookie y autenticación

**Estado:** aceptada (Fase 2).

## Decisión

- **Sesiones opacas en base de datos**, no JWT. La cookie `gc_session` (httpOnly, SameSite=Lax, Secure en producción) lleva un token aleatorio. La base guarda solo su hash SHA-256. Así cerrar una sesión o todas tiene efecto inmediato.
  - Comercios: 12 h de inactividad y 30 días como máximo.
  - Plataforma (`gc_psession`): 2 h de inactividad y 12 h como máximo.
- **CSRF de doble envío.** Toda mutación exige que el encabezado `x-csrf-token` coincida con la cookie `gc_csrf`.
- **Contraseñas** con Argon2id (parámetros OWASP), un mínimo de 10 caracteres y una lista de contraseñas comunes.
- **Bloqueo por intentos fallidos** por IP y por email.
- **Administradores de plataforma** con TOTP obligatorio. El secreto se guarda cifrado con AES-256-GCM usando `APP_ENCRYPTION_KEY`.
- **Recuperación de contraseña** con un token de un solo uso que vence en 30 minutos. Al usarlo se cierran todas las sesiones. La respuesta es la misma exista o no el email.

## Pendiente

- MFA opcional para dueños de comercio.
- El limitador de intentos vive en memoria del proceso. Sirve mientras haya una sola instancia. Antes de escalar horizontalmente hay que moverlo a PostgreSQL o Redis.
