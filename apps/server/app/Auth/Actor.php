<?php

namespace App\Auth;

use App\Support\AppError;

/** Usuario autenticado de un comercio, resuelto en cada request desde su sesión. */
final class Actor
{
    /**
     * @param  array<string, true>  $permissions  conjunto de códigos de permiso
     * @param  list<string>  $branchIds
     */
    public function __construct(
        public readonly string $userId,
        public readonly string $userName,
        public readonly string $sessionId,
        public readonly ?string $tenantId,
        public readonly ?string $tenantStatus,
        public readonly ?string $membershipId,
        public readonly ?string $roleId,
        public readonly array $permissions,
        public readonly array $branchIds,
        public readonly string $ip,
        public readonly string $requestId,
    ) {}

    public function can(string $permission): bool
    {
        return isset($this->permissions[$permission]);
    }

    /** @return list<string> */
    public function permissionList(): array
    {
        $list = array_keys($this->permissions);
        sort($list);

        return $list;
    }

    /** Lanza CANNOT_GRANT si se intenta otorgar permisos que el actor no tiene (evita escalar privilegios). */
    public function assertCanGrant(iterable $permissions): void
    {
        $missing = [];
        foreach ($permissions as $p) {
            if (! $this->can($p)) {
                $missing[] = $p;
            }
        }
        if ($missing !== []) {
            throw AppError::badRequest('CANNOT_GRANT', 'No podés otorgar permisos que no tenés: '.implode(', ', $missing));
        }
    }
}
