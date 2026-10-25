<?php

namespace App\Services;

use App\Models\Membership;
use App\Models\MembershipBranch;
use App\Models\RolePermission;
use App\Models\Tenant;
use App\Support\Catalog;
use App\Tenancy\TenantContext;

/** Arma el contexto de permisos del usuario en un comercio. */
class MembershipContext
{
    public function __construct(private readonly TenantContext $context) {}

    /** @return array{tenantStatus: string, membershipId: string, roleId: string, permissions: array<string, true>, branchIds: list<string>}|null */
    public function load(string $tenantId, string $userId): ?array
    {
        return $this->context->run($tenantId, function () use ($tenantId, $userId) {
            $membership = Membership::where('user_id', $userId)->where('status', 'active')->first();
            $tenant = Tenant::find($tenantId);
            if (! $membership || ! $tenant) {
                return null;
            }
            $valid = array_flip(Catalog::permissionCodes());
            $permissions = [];
            foreach (RolePermission::where('role_id', $membership->role_id)->pluck('permission_code') as $code) {
                if (isset($valid[$code])) {
                    $permissions[$code] = true;
                }
            }

            return [
                'tenantStatus' => $tenant->status,
                'membershipId' => $membership->id,
                'roleId' => $membership->role_id,
                'permissions' => $permissions,
                'branchIds' => MembershipBranch::where('membership_id', $membership->id)->pluck('branch_id')->all(),
            ];
        });
    }
}
