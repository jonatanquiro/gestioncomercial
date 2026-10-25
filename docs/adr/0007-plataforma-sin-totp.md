# ADR 0007 · Panel de plataforma sin código TOTP

**Estado:** aceptada el 2026-10-25 · **Modifica a:** [0003](0003-sesiones-y-autenticacion.md).

## Motivo

El ingreso al panel de plataforma pedía, además de la contraseña, un código de 6 dígitos de una app de autenticación. Jona no lo había pedido y le complicaba el uso, así que pidió sacarlo.

## Decisión

- Los operadores entran con email y contraseña.
- Se mantienen las demás protecciones: Argon2id, límite de 10 intentos cada 15 minutos por IP, sesión propia con cookie httpOnly, CSRF y auditoría de ingresos y de intentos fallidos.
- Se borra la columna `platform_users.totp_secret_enc` (migración `2026_10_25_000003`) y la dependencia `pragmarx/google2fa`.

## Consecuencias

Quien consiga la contraseña de un operador entra al panel, que ve todos los comercios y puede suspenderlos y darlos de alta. Conviene usar contraseñas largas y únicas para los operadores. Si más adelante se quiere un segundo factor, se puede volver a agregar sin tocar los datos de los comercios.
