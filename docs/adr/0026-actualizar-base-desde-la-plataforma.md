# ADR 0026 · Actualizar la base desde el panel de plataforma

**Estado:** aceptada el 2026-11-12.

## Contexto

Ferozo no tiene SSH. Los archivos se suben por FTP (`scripts/subir-ferozo.mjs`), pero `php artisan migrate` no se puede correr. Hasta ahora, cada cambio de base se pasaba a mano a un SQL y se importaba en phpMyAdmin. Con muchas migraciones juntas eso es fácil de equivocar. Además, ese SQL no sincroniza los catálogos (permisos, rubros, planes), que se actualizan al terminar `migrate`.

## Decisiones

1. **Pantalla «Base de datos» en el panel de plataforma** (`/plataforma/base`), solo para operadores de plataforma. Muestra:
   - la versión del servidor de base;
   - si es compatible;
   - la lista de migraciones pendientes.
2. **«Actualizar base de datos»** corre `migrate --force` desde la propia aplicación. Así también se sincronizan los catálogos.
   - Pide confirmar que se hizo un respaldo.
   - Usa un bloqueo para que no se ejecute dos veces a la vez.
   - Queda en la auditoría de plataforma, tanto si se aplica como si falla.
   - Si falla, muestra qué llegó a aplicarse y el detalle del error.
3. **Control de compatibilidad.** Si el servidor no admite `ALTER TABLE … DROP CONSTRAINT` (MariaDB anterior a 10.2, MySQL anterior a 8.0.19), no se aplica nada: así la base no queda a medias.
4. **Disparadores.** Siguen siendo opcionales (ADR 0011): si el hosting no los permite, la migración avisa en el registro y sigue.

## Límites conocidos

- **Si se corta a mitad de camino:** los cambios de estructura de MySQL no se deshacen solos. Hay que restaurar el respaldo antes de reintentar.
- **Tiempo entre la subida y la actualización:** entre que se suben los archivos y se aplica la actualización, las pantallas que usan tablas nuevas pueden fallar. Conviene hacerlo con el negocio cerrado y en pocos minutos.

## Verificación

- **Pruebas de integración:**
  - estado y versión;
  - una migración pendiente se aplica y queda auditada;
  - pide confirmación;
  - sin pendientes no hace nada;
  - una sesión de comercio no accede.
