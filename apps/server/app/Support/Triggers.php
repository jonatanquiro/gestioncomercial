<?php

namespace App\Support;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;

/**
 * Crea los disparadores que hacen de "solo agregado" a la auditoría, los movimientos de stock,
 * las ventas y los turnos cerrados. Algunos hostings compartidos no dejan crear disparadores
 * (falta el permiso TRIGGER o SUPER con binlog activo): ahí el sistema funciona igual, porque
 * el programa nunca modifica ni borra esas filas, pero la base no lo impide por su cuenta.
 * En ese caso se avisa en el log y la migración sigue. Ver docs/adr/0011.
 *
 * El CREATE TRIGGER lo ejecuta la migración (dentro de $create); acá solo se decide qué hacer si falla.
 */
final class Triggers
{
    /** 1142: TRIGGER command denied · 1227: falta privilegio (DEFINER) · 1419: SUPER con binlog activo. */
    private const SIN_PERMISO = [1142, 1227, 1419];

    public static function create(string $name, callable $create): void
    {
        try {
            $create();
        } catch (QueryException $e) {
            if (! in_array((int) ($e->errorInfo[1] ?? 0), self::SIN_PERMISO, true)) {
                throw $e;
            }
            $mensaje = "La base no permite crear el disparador {$name}: esa tabla queda protegida solo por el programa. ".$e->getMessage();
            Log::warning($mensaje);
            if (app()->runningInConsole()) {
                fwrite(STDERR, "Aviso: {$mensaje}\n");
            }
        }
    }
}
