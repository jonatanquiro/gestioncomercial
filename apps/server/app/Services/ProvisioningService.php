<?php

namespace App\Services;

use App\Auth\Client;
use App\Models\Branch;
use App\Models\BusinessType;
use App\Models\Category;
use App\Models\Membership;
use App\Models\MembershipBranch;
use App\Models\Plan;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\Subscription;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Support\AppError;
use App\Support\Catalog;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Alta de un comercio con todo lo necesario para operar: suscripción de prueba, sucursal y
 * depósito por defecto, roles plantilla y membresía del propietario. Corre dentro de la
 * transacción del registro.
 */
class ProvisioningService
{
    public const DEFAULT_PLAN_CODE = 'inicial';

    public function __construct(
        private readonly TenantContext $context,
        private readonly AuditService $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $input  datos validados del registro (planCode opcional)
     * @param  array{actorType: string, actorId: string, actorName: string}|null  $by  quién da el alta (por defecto, el propio dueño)
     */
    public function create(string $ownerUserId, string $ownerName, array $input, Client $client, ?array $by = null): string
    {
        $businessType = BusinessType::find($input['businessTypeCode']);
        if (! $businessType) {
            throw AppError::validation([['path' => 'businessTypeCode', 'message' => 'Rubro inexistente']]);
        }
        $planCode = $input['planCode'] ?? self::DEFAULT_PLAN_CODE;
        $plan = Plan::where('code', $planCode)->first()
            ?? throw new RuntimeException("No existe el plan {$planCode}; corré las migraciones");
        $by ??= ['actorType' => 'user', 'actorId' => $ownerUserId, 'actorName' => $ownerName];

        $tenant = Tenant::create([
            'trade_name' => $input['tradeName'],
            'legal_name' => $input['legalName'] ?? null,
            'cuit' => $input['cuit'] ?? null,
            'tax_condition' => $input['taxCondition'],
            'business_type_code' => $businessType->code,
            'status' => 'trial',
            'settings' => [
                'allowNegativeStock' => (bool) $businessType->default_settings['allowNegativeStock'],
                'priceRoundingStep' => (int) $businessType->default_settings['priceRoundingStep'],
            ],
        ]);

        $this->context->run($tenant->id, function () use ($tenant, $plan, $ownerUserId, $businessType, $input, $client, $by) {
            Subscription::create([
                'plan_id' => $plan->id,
                'status' => 'trialing',
                'trial_ends_at' => Carbon::now()->addDays($plan->trial_days),
            ]);

            $branch = Branch::create(['name' => 'Casa central']);
            Warehouse::create(['branch_id' => $branch->id, 'name' => 'Depósito principal', 'is_default' => true]);

            // Categorías iniciales del rubro (sección 11 del diseño); el comercio las edita después.
            foreach ($businessType->default_categories as $name) {
                Category::create(['name' => $name]);
            }

            $ownerRoleId = null;
            $links = [];
            foreach (Catalog::roleTemplates() as $template) {
                $role = Role::create([
                    'id' => (string) Str::uuid7(),
                    'name' => $template['name'],
                    'is_system' => $template['code'] === 'owner',
                    'template_code' => $template['code'],
                ]);
                if ($template['code'] === 'owner') {
                    $ownerRoleId = $role->id;
                }
                foreach ($template['permissions'] as $code) {
                    $links[] = ['role_id' => $role->id, 'permission_code' => $code];
                }
            }
            RolePermission::insertForTenant($links);

            $membership = Membership::create(['user_id' => $ownerUserId, 'role_id' => $ownerRoleId, 'status' => 'active']);
            MembershipBranch::create(['membership_id' => $membership->id, 'branch_id' => $branch->id]);

            $this->audit->record([
                'tenantId' => $tenant->id,
                'actorType' => $by['actorType'],
                'actorId' => $by['actorId'],
                'actorName' => $by['actorName'],
                'action' => 'tenant.created',
                'entityType' => 'tenant',
                'entityId' => $tenant->id,
                'after' => ['tradeName' => $input['tradeName'], 'businessType' => $businessType->code, 'plan' => $plan->code],
                'ip' => $client->ip,
                'requestId' => $client->requestId,
            ]);
        });

        return $tenant->id;
    }
}
