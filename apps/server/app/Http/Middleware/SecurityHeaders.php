<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Encabezados de seguridad para la web y la API. */
class SecurityHeaders
{
    private const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        ."connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $headers = $response->headers;
        $headers->set('Content-Security-Policy', self::CSP);
        $headers->set('X-Content-Type-Options', 'nosniff');
        $headers->set('X-Frame-Options', 'DENY');
        $headers->set('Referrer-Policy', 'same-origin');

        return $response;
    }
}
