<?php

namespace App\Support;

use Illuminate\Support\Facades\RateLimiter;

/** Límite de intentos por ventana, guardado en la caché de la base (sirve con varias instancias). */
class Throttle
{
    public static function consume(string $key, int $limit, int $windowSeconds): void
    {
        $key = 'gc:'.$key;
        if (RateLimiter::tooManyAttempts($key, $limit)) {
            throw AppError::tooManyRequests();
        }
        RateLimiter::hit($key, $windowSeconds);
    }

    /** Como consume, pero devuelve false en lugar de lanzar. */
    public static function attempt(string $key, int $limit, int $windowSeconds): bool
    {
        try {
            self::consume($key, $limit, $windowSeconds);

            return true;
        } catch (AppError) {
            return false;
        }
    }

    public static function reset(string $key): void
    {
        RateLimiter::clear('gc:'.$key);
    }
}
