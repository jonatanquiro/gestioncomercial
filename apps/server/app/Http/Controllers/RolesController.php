<?php

namespace App\Http\Controllers;

use App\Models\Membership;
use App\Models\Role;
use App\Models\RolePermission;
use App\Services\AuditService;
use App\Support\AppError;
use App\Support\Catalog;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class RolesController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(): JsonResponse
    {
        $valid = array_flip(Catalog::permissionCodes());
        $perms = RolePermission::all()->groupBy('role_id');
        $members = Membership::where('status', 'active')->groupBy('role_id')
            ->selectRaw('role_id, count(*) as n')->pluck('n', 'role_id');

        return $this->json(Role::orderBy('created_at')->get()->map(function (Role $r) use ($perms, $valid, $members) {
            $codes = collect($perms->get($r->id, []))->pluck('permission_code')
                ->filter(fn ($c) => isset($valid[$c]))->sort()->values()->all();

            return [
                'id' => $r->id,
                'name' => $r->name,
                'isSystem' => $r->is_system,
                'templateCode' => $r->template_code,
                'permissions' => $codes,
                'memberCount' => (int) ($members[$r->id] ?? 0),
            ];
        })->all());
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->validated($request);
        $actor->assertCanGrant($input['permissions']);

        return $this->json(DB::transaction(function () use ($actor, $input) {
            $role = Role::create(['name' => $input['name']]);
            $this->setPermissions($role->id, $input['permissions']);
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'role.created',
                'entityType' => 'role',
                'entityId' => $role->id,
                'after' => $input,
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);

            return ['id' => $role->id];
        }), 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->validated($request);

        return $this->json(DB::transaction(function () use ($actor, $id, $input) {
            $role = Role::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Rol');
            if ($role->is_system) {
                throw AppError::conflict('SYSTEM_ROLE', 'El rol Propietario no se puede modificar');
            }
            $valid = array_flip(Catalog::permissionCodes());
            $before = RolePermission::where('role_id', $id)->pluck('permission_code')->all();
            // Solo se exige tener los permisos que cambian (agregados o quitados).
            $changed = array_merge(
                array_diff($input['permissions'], $before),
                array_filter(array_diff($before, $input['permissions']), fn ($p) => isset($valid[$p])),
            );
            $actor->assertCanGrant($changed);
            $role->fill(['name' => $input['name']])->save();
            RolePermission::where('role_id', $id)->delete();
            $this->setPermissions($id, $input['permissions']);
            sort($before);
            $after = $input['permissions'];
            sort($after);
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'role.updated',
                'entityType' => 'role',
                'entityId' => $id,
                'before' => ['name' => $role->getOriginal('name'), 'permissions' => $before],
                'after' => ['name' => $input['name'], 'permissions' => $after],
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);

            return ['id' => $id];
        }));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        DB::transaction(function () use ($actor, $id) {
            $role = Role::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Rol');
            if ($role->is_system) {
                throw AppError::conflict('SYSTEM_ROLE', 'El rol Propietario no se puede eliminar');
            }
            if (Membership::where('role_id', $id)->exists()) {
                throw AppError::conflict('ROLE_IN_USE', 'El rol tiene empleados asignados (activos o inactivos). Reasignalos antes de eliminarlo.');
            }
            $role->delete();
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'role.deleted',
                'entityType' => 'role',
                'entityId' => $id,
                'before' => ['name' => $role->name],
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);
        });

        return $this->json(['ok' => true]);
    }

    /** @return array{name: string, permissions: list<string>} */
    private function validated(Request $request): array
    {
        $input = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:60'],
            'permissions' => ['present', 'array', 'list', 'max:200'],
            'permissions.*' => ['string', Rule::in(Catalog::permissionCodes())],
        ]);

        return ['name' => $input['name'], 'permissions' => array_values($input['permissions'])];
    }

    /** @param  list<string>  $permissions */
    private function setPermissions(string $roleId, array $permissions): void
    {
        RolePermission::insertForTenant(array_map(
            fn ($code) => ['role_id' => $roleId, 'permission_code' => $code],
            array_values(array_unique($permissions)),
        ));
    }
}
