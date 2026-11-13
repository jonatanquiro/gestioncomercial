<?php

namespace App\Http\Middleware;

use App\Auth\Cookies;
use App\Auth\PlatformActor;
use App\Services\PlatformSessionService;
use App\Support\AppError;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Exige una sesión del panel de plataforma (cookie propia, separada de las de comercios). */
class AuthenticatePlatform
{
    public function __construct(private readonly PlatformSessionService $sessions) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->cookie(Cookies::PLATFORM_SESSION);
        $valid = is_string($token) && $token !== '' ? $this->sessions->validate($token) : null;
        if (! $valid) {
            throw AppError::unauthenticated();
        }
        $request->attributes->set('platformActor', new PlatformActor(
            platformUserId: $valid['user']->id,
            name: $valid['user']->name,
            sessionId: $valid['session']->id,
            ip: $request->ip() ?? '0.0.0.0',
            requestId: (string) $request->attributes->get('requestId', ''),
        ));

        return $next($request);
    }
}
