# ADR 0011 · Disparadores opcionales en hostings que no los permiten

**Estado:** aceptada el 2026-10-27.

## Motivo

La auditoría, los movimientos de stock, el historial de costos, las ventas y los turnos de caja cerrados son de solo agregado. Además de que el programa nunca modifica ni borra esas filas, la base lo impide con disparadores (`BEFORE UPDATE` / `BEFORE DELETE` con `SIGNAL`). Al publicar en el hosting compartido de Ferozo, la importación falló al crear el primer disparador: los usuarios de esos hostings no suelen tener permiso `TRIGGER`, o lo tienen pero el servidor exige `SUPER` porque el registro binario está activo. Jona decidió publicar sin disparadores.

## Decisión

- Las migraciones crean los disparadores con `App\Support\Triggers::create()`. Si la base los rechaza por falta de permiso (errores 1142, 1227 o 1419), se registra un aviso en el log y en la consola y la migración sigue. Cualquier otro error corta la migración, como antes.
- Para pasar una base de XAMPP al hosting se exporta sin disparadores (`mysqldump --skip-triggers`).
- En XAMPP y en CI los disparadores se crean igual que siempre, y las pruebas que los verifican no cambian.

## Consecuencias

- En un hosting sin disparadores, la regla de solo agregado depende solo del programa. Alguien con acceso directo a la base (por ejemplo, desde phpMyAdmin) podría modificar o borrar esas filas.
- Si el hosting habilita después el permiso, alcanza con volver a crear los disparadores: son los `CREATE TRIGGER` de las migraciones `2026_10_25_000001`, `000004` y `000005`.
