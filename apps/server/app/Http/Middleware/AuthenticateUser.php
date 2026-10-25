<?php

namespace App\Http\Middleware;

use App\Auth\Actor;
use App\Auth\Cookies;
use App\Services\MembershipContext;
use App\Services\SessionService;
use App\Support\AppError;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Exige una sesión de comercio válida y arma el actor del request. Fija el comercio activo
 * en TenantContext a partir de la sesión. Con el parámetro "any" la ruta acepta usuarios
 * sin comercio activo o con el comercio suspendido (por ejemplo /auth/me).
 */
class AuthenticateUser
{
    public function __construct(
        private readonly SessionService $sessions,
        private readonly MembershipContext $memberships,
        private readonly TenantContext $context,
    ) {}

    public function handle(Request $request, Closure $next, ?string $mode = null): Response
    {
        $token = $request->cookie(Cookies::SESSION);
        $valid = is_string($token) && $token !== '' ? $this->sessions->validate($token) : null;
        if (! $valid) {
            throw AppError::unauthenticated();
        }
        ['session' => $session, 'user' => $user] = $valid;

        $membership = $session->tenant_id ? $this->memberships->load($session->tenant_id, $user->id) : null;
        $actor = new Actor(
            userId: $user->id,
            userName: $user->name,
            sessionId: $session->id,
            tenantId: $membership ? $session->tenant_id : null,
            tenantStatus: $membership['tenantStatus'] ?? null,
            membershipId: $membership['membershipId'] ?? null,
            roleId: $membership['roleId'] ?? null,
            permissions: $membership['permissions'] ?? [],
            branchIds: $membership['branchIds'] ?? [],
            ip: $request->ip() ?? '0.0.0.0',
            requestId: (string) $request->attributes->get('requestId', ''),
        );
        $request->attributes->set('actor', $actor);

        if ($mode !== 'any') {
            if ($actor->tenantId === null) {
                throw AppError::noTenant();
            }
            if (in_array($actor->tenantStatus, ['suspended', 'cancelled'], true)) {
                throw AppError::tenantSuspended();
            }
        }
        $this->context->set($actor->tenantId);

        return $next($request);
    }
}
