# ADR 0027 · Operadores del panel de plataforma desde el panel

**Estado:** aceptada el 2026-11-12.

## Contexto

Los operadores del panel de plataforma solo se creaban con `php artisan platform:create-admin`. En Ferozo no hay consola: había que generar un SQL e importarlo en phpMyAdmin. Lo mismo pasaba para cambiar una clave olvidada.

## Decisiones

1. **Pantalla «Operadores» en el panel** (`/plataforma/operadores`). Cualquier operador activo puede dar de alta otro operador (nombre, email y clave inicial), cambiarle la clave y desactivarlo o activarlo. Hay un solo rol, como hasta ahora.
2. **Sesiones.**
   - Al desactivar a alguien o cambiarle la clave, se cierran sus sesiones abiertas.
   - Al cambiar la propia clave, se cierran las otras sesiones y se conserva la actual.
3. **Nadie se desactiva a sí mismo.** Así siempre queda al menos un operador que puede entrar.
4. **Reglas de clave.** Son las mismas de siempre: entre 10 y 128 caracteres, y no puede ser una clave común. Todo queda en la auditoría de plataforma.
5. **El comando de consola sigue disponible** para el primer operador de una instalación nueva.

## Verificación

- **Pruebas de integración:**
  - alta con validación y email repetido;
  - cambio de clave que cierra la sesión del otro;
  - no se puede desactivar a uno mismo;
  - desactivar cierra sesiones e impide entrar, y reactivar devuelve el acceso;
  - cambiar la propia clave no cierra la sesión actual;
  - una sesión de comercio no accede.
