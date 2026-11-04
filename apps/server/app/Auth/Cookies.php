<?php

namespace App\Auth;

use App\Support\Tokens;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

/** Cookies de sesión (httpOnly) y CSRF de doble envío (legible por la web). */
final class Cookies
{
    public const SESSION = 'gc_session';

    public const PLATFORM_SESSION = 'gc_psession';

    public const CSRF = 'gc_csrf';

    public const CSRF_HEADER = 'x-csrf-token';

    public const SESSION_IDLE_SECONDS = 12 * 3600;

    public const SESSION_MAX_SECONDS = 30 * 24 * 3600;

    public const PLATFORM_IDLE_SECONDS = 2 * 3600;

    public const PLATFORM_MAX_SECONDS = 12 * 3600;

    public static function session(string $name, string $token, int $maxAgeSeconds): Cookie
    {
        return self::make($name, $token, $maxAgeSeconds, true);
    }

    public static function forget(string $name): Cookie
    {
        return self::make($name, '', -2628000, true);
    }

    public static function csrf(string $token): Cookie
    {
        return self::make(self::CSRF, $token, self::SESSION_MAX_SECONDS, false);
    }

    /** Reutiliza el token CSRF vigente o crea uno nuevo. Devuelve [token, cookie|null]. */
    public static function ensureCsrf(Request $request): array
    {
        $current = $request->cookie(self::CSRF);
        if (is_string($current) && strlen($current) >= 32) {
            return [$current, null];
        }
        $token = Tokens::random();

        return [$token, self::csrf($token)];
    }

    private static function make(string $name, string $value, int $maxAgeSeconds, bool $httpOnly): Cookie
    {
        return Cookie::create($name, $value, time() + $maxAgeSeconds, (string) config('session.path', '/'), null, (bool) config('session.secure'), $httpOnly, true, Cookie::SAMESITE_LAX);
    }
}
