<?php

namespace App\Http\Controllers;

use App\Models\Branch;
use App\Models\Membership;
use App\Models\Tenant;
use App\Services\AuditService;
use App\Services\EntitlementsService;
use App\Support\AppError;
use App\Support\Catalog;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Datos del comercio activo. El id sale siempre de la sesión, nunca del pedido. */
class TenantController extends Controller
{
    public function __construct(
        private readonly EntitlementsService $entitlements,
        private readonly AuditService $audit,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return $this->json($this->load($this->actor($request)->tenantId));
    }

    public function update(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $data = $this->body($request);
        if (isset($data['email'])) {
            $data['email'] = Input::email($data['email']);
        }
        $input = Input::validate($data, [
            'tradeName' => ['required', 'string', 'max:120'],
            'legalName' => ['nullable', 'string', 'max:160'],
            'cuit' => ['nullable', 'string', Input::cuitRule()],
            'taxCondition' => ['required', 'string', Rule::in(Catalog::taxConditions())],
            'address' => ['nullable', 'string', 'max:200'],
            'phone' => ['nullable', 'string', 'max:40'],
            'email' => ['nullable', 'string', 'email', 'max:254'],
            'settings' => ['required', 'array'],
            'settings.allowNegativeStock' => ['present', Input::strictBoolean()],
            'settings.priceRoundingStep' => ['present', Input::oneOfIntegers([0, 1, 5, 10, 50, 100])],
        ]);
        $after = [
            'tradeName' => $input['tradeName'],
            'legalName' => $input['legalName'] ?? null,
            'cuit' => Input::optionalCuit($input['cuit'] ?? null),
            'taxCondition' => $input['taxCondition'],
            'address' => $input['address'] ?? null,
            'phone' => $input['phone'] ?? null,
            'email' => $input['email'] ?? null,
            'settings' => [
                'allowNegativeStock' => (bool) $input['settings']['allowNegativeStock'],
                'priceRoundingStep' => (int) $input['settings']['priceRoundingStep'],
            ],
        ];

        return $this->json(DB::transaction(function () use ($actor, $after) {
            $tenant = Tenant::whereKey($actor->tenantId)->lockForUpdate()->first() ?? throw AppError::notFound('Comercio');
            $before = [
                'tradeName' => $tenant->trade_name,
                'legalName' => $tenant->legal_name,
                'cuit' => $tenant->cuit,
                'taxCondition' => $tenant->tax_condition,
                'address' => $tenant->address,
                'phone' => $tenant->phone,
                'email' => $tenant->email,
                'settings' => $tenant->settings,
            ];
            $tenant->forceFill([
                'trade_name' => $after['tradeName'],
                'legal_name' => $after['legalName'],
                'cuit' => $after['cuit'],
                'tax_condition' => $after['taxCondition'],
                'address' => $after['address'],
                'phone' => $after['phone'],
                'email' => $after['email'],
                'settings' => $after['settings'],
                'version' => $tenant->version + 1,
            ])->save();
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'tenant.updated',
                'entityType' => 'tenant',
                'entityId' => $actor->tenantId,
                'before' => $before,
                'after' => $after,
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);

            return $this->load($actor->tenantId);
        }));
    }

    /** Forma de TenantDto. */
    private function load(string $tenantId): array
    {
        $t = Tenant::find($tenantId) ?? throw AppError::notFound('Comercio');

        return [
            'id' => $t->id,
            'tradeName' => $t->trade_name,
            'legalName' => $t->legal_name,
            'cuit' => $t->cuit,
            'taxCondition' => $t->tax_condition,
            'address' => $t->address,
            'phone' => $t->phone,
            'email' => $t->email,
            'businessTypeCode' => $t->business_type_code,
            'status' => $t->status,
            'settings' => $t->settings,
            'plan' => $this->entitlements->plan(),
            'usage' => [
                'branches' => Branch::where('status', 'active')->count(),
                'users' => Membership::where('status', 'active')->count(),
            ],
        ];
    }
}
