<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/** Identificador por request (para logs y errores) y respuestas de la API sin caché. */
class AssignRequestId
{
    public function handle(Request $request, Closure $next): Response
    {
        $incoming = $request->headers->get('x-request-id');
        $id = is_string($incoming) && preg_match('/^[\w-]{8,64}$/', $incoming) ? $incoming : (string) Str::uuid();
        $request->attributes->set('requestId', $id);

        $response = $next($request);
        $response->headers->set('x-request-id', $id);
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }
}
