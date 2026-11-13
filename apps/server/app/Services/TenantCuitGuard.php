<?php

namespace App\Services;

use App\Models\Membership;
use App\Models\Tenant;
use App\Support\AppError;

/**
 * Un CUIT puede estar en varios comercios solo si son del mismo dueño (ADR 0025): quien tiene
 * una despensa y una tienda de ropa factura las dos con su CUIT. Si el CUIT es de otra persona,
 * se rechaza como siempre.
 */
class TenantCuitGuard
{
    public function __construct(private readonly AuthService $auth) {}

    /**
     * @param  list<string>  $ownerUserIds  dueños del comercio que quiere usar el CUIT
     * @param  ?string  $tenantId  el propio comercio, si ya existe
     */
    public function assertAvailable(?string $cuit, array $ownerUserIds, ?string $tenantId = null): void
    {
        if ($cuit === null) {
            return;
        }
        $others = Tenant::where('cuit', $cuit)->where('status', '<>', 'cancelled')
            ->when($tenantId, fn ($q, $id) => $q->whereKeyNot($id))->pluck('id')->all();
        if ($others === []) {
            return;
        }
        foreach ($ownerUserIds as $userId) {
            if ($this->auth->ownsAll($userId, $others)) {
                return;
            }
        }
        throw AppError::conflict('CUIT_TAKEN', 'Ya hay un comercio de otra persona registrado con ese CUIT');
    }

    /** Dueños activos del comercio del contexto. @return list<string> */
    public function ownersOfCurrent(): array
    {
        return Membership::join('roles', 'roles.id', '=', 'memberships.role_id')
            ->where('memberships.status', 'active')->where('roles.template_code', 'owner')
            ->pluck('memberships.user_id')->all();
    }
}
