<?php

namespace App\Http\Middleware;

use App\Auth\Actor;
use App\Support\AppError;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** perm:a,b → el actor necesita al menos uno de los permisos indicados. */
class RequirePermission
{
    public function handle(Request $request, Closure $next, string ...$anyOf): Response
    {
        /** @var Actor|null $actor */
        $actor = $request->attributes->get('actor');
        if (! $actor) {
            throw AppError::unauthenticated();
        }
        foreach ($anyOf as $permission) {
            if ($actor->can($permission)) {
                return $next($request);
            }
        }
        throw AppError::forbidden(implode(' | ', $anyOf));
    }
}
