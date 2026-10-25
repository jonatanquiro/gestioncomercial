<?php

namespace App\Http\Controllers;

use App\Models\Branch;
use App\Models\Warehouse;
use App\Services\AuditService;
use App\Services\EntitlementsService;
use App\Services\SalesSetup;
use App\Services\StockService;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BranchesController extends Controller
{
    public function __construct(
        private readonly EntitlementsService $entitlements,
        private readonly AuditService $audit,
        private readonly StockService $stock,
        private readonly SalesSetup $sales,
    ) {}

    public function index(): JsonResponse
    {
        return $this->json(Branch::orderBy('created_at')->get()->map(fn (Branch $b) => $this->dto($b))->all());
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:80'],
            'address' => ['nullable', 'string', 'max:200'],
        ]);
        $input = ['name' => $input['name'], 'address' => $input['address'] ?? null];

        return $this->json(DB::transaction(function () use ($actor, $input) {
            $this->entitlements->lockTenant($actor->tenantId);
            $this->entitlements->assertBelowLimit('max_branches', Branch::where('status', 'active')->count());
            $branch = Branch::create($input);
            $warehouse = Warehouse::create(['branch_id' => $branch->id, 'name' => 'Depósito principal', 'is_default' => true]);
            $this->stock->initWarehouse($warehouse->id);
            $this->sales->forBranch($branch->id);
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'branch.created',
                'entityType' => 'branch',
                'entityId' => $branch->id,
                'after' => $input,
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);

            return $this->dto($branch->refresh());
        }), 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:80'],
            'address' => ['nullable', 'string', 'max:200'],
            'status' => ['required', 'string', 'in:active,inactive'],
        ]);
        $input = ['name' => $input['name'], 'address' => $input['address'] ?? null, 'status' => $input['status']];

        return $this->json(DB::transaction(function () use ($actor, $id, $input) {
            $this->entitlements->lockTenant($actor->tenantId);
            $branch = Branch::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Sucursal');
            $before = ['name' => $branch->name, 'address' => $branch->address, 'status' => $branch->status];
            $active = Branch::where('status', 'active')->count();
            if ($branch->status === 'active' && $input['status'] === 'inactive' && $active <= 1) {
                throw AppError::conflict('LAST_BRANCH', 'El comercio debe tener al menos una sucursal activa');
            }
            if ($branch->status === 'inactive' && $input['status'] === 'active') {
                $this->entitlements->assertBelowLimit('max_branches', $active);
            }
            $branch->fill($input)->save();
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'branch.updated',
                'entityType' => 'branch',
                'entityId' => $id,
                'before' => $before,
                'after' => $input,
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);

            return $this->dto($branch);
        }));
    }

    /** Forma de BranchDto. */
    private function dto(Branch $b): array
    {
        return ['id' => $b->id, 'name' => $b->name, 'address' => $b->address, 'status' => $b->status, 'createdAt' => Dates::iso($b->created_at)];
    }
}
