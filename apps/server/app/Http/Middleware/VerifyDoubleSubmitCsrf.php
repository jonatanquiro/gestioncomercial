<?php

namespace App\Http\Middleware;

use App\Auth\Cookies;
use App\Support\AppError;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** CSRF de doble envío: toda mutación exige que el header x-csrf-token coincida con la cookie gc_csrf. */
class VerifyDoubleSubmitCsrf
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            $cookie = $request->cookie(Cookies::CSRF);
            $header = $request->headers->get(Cookies::CSRF_HEADER);
            if (! is_string($cookie) || $cookie === '' || ! is_string($header) || ! hash_equals($cookie, $header)) {
                throw AppError::csrf();
            }
        }

        return $next($request);
    }
}
