<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Membership;
use App\Models\MembershipBranch;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\User;
use App\Services\AuditService;
use App\Services\AuthService;
use App\Services\EntitlementsService;
use App\Services\PasswordService;
use App\Services\SessionService;
use App\Support\AppError;
use App\Support\Catalog;
use App\Support\Dates;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class EmployeesController extends Controller
{
    public function __construct(
        private readonly PasswordService $passwords,
        private readonly EntitlementsService $entitlements,
        private readonly AuditService $audit,
        private readonly AuthService $auth,
        private readonly SessionService $sessions,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $links = MembershipBranch::all()->groupBy('membership_id');
        $rows = Membership::query()
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->join('roles', function ($join) {
                $join->on('roles.tenant_id', '=', 'memberships.tenant_id')->on('roles.id', '=', 'memberships.role_id');
            })
            ->orderBy('users.name')
            ->get([
                'memberships.id as membership_id', 'users.id as user_id', 'users.name', 'users.email', 'users.username',
                'roles.id as role_id', 'roles.name as role_name', 'memberships.status', 'memberships.created_at',
            ]);
        $settable = array_flip($this->auth->usersOnlyIn($actor->tenantId, $rows->pluck('user_id')->unique()->values()->all()));

        return $this->json($rows->map(fn ($r) => [
            'membershipId' => $r->membership_id,
            'userId' => $r->user_id,
            'name' => $r->name,
            'email' => $r->email,
            'username' => $r->username,
            'canSetPassword' => isset($settable[$r->user_id]) && $r->user_id !== $actor->userId,
            'roleId' => $r->role_id,
            'roleName' => $r->role_name,
            'status' => $r->status,
            'createdAt' => Dates::iso($r->created_at),
            'branchIds' => collect($links->get($r->membership_id, []))->pluck('branch_id')->values()->all(),
        ])->all());
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $data = $this->body($request);
        $data['email'] = Input::email($data['email'] ?? null);
        $data['username'] = Input::email($data['username'] ?? null);
        $input = Input::validate($data, [
            'name' => ['required', 'string', 'max:120'],
            'username' => [...Input::usernameRules(), 'required_without:email'],
            'email' => ['nullable', 'string', 'email', 'max:254'],
            'password' => Input::passwordRules(),
            'roleId' => ['required', 'string', 'uuid'],
            ...self::branchRules(),
        ], Input::passwordMessages('password') + Input::usernameMessages('username') + self::branchMessages()
            + ['username.required_without' => 'Indicá un nombre de usuario o un email']);
        $input['email'] ??= null;
        $input['username'] ??= null;
        $passwordHash = $this->passwords->hash($input['password']);
        $branchIds = array_values(array_unique($input['branchIds']));

        return $this->json(DB::transaction(function () use ($actor, $input, $passwordHash, $branchIds) {
            $this->assertCanAssignRole($actor, $input['roleId']);
            $this->entitlements->lockTenant($actor->tenantId);
            $this->entitlements->assertBelowLimit('max_users', Membership::where('status', 'active')->count());

            // La identidad es global: si el email ya existe, se suma al comercio sin tocar su contraseña.
            $existing = $input['email'] !== null ? User::where('email', $input['email'])->first() : null;
            if ($existing && $input['username'] !== null && $input['username'] !== $existing->username) {
                throw AppError::validation([['path' => 'username', 'message' => 'Ese email ya tiene cuenta: dejá el usuario vacío y la persona ingresa con su email']]);
            }
            if (! $existing && $input['username'] !== null && User::where('username', $input['username'])->exists()) {
                throw AppError::conflict('USERNAME_IN_USE', 'Ese nombre de usuario ya está en uso');
            }
            $user = $existing ?? User::create([
                'username' => $input['username'],
                'email' => $input['email'],
                'name' => $input['name'],
                'password_hash' => $passwordHash,
                'password_changed_at' => Carbon::now(),
            ]);
            $membership = Membership::create(['user_id' => $user->id, 'role_id' => $input['roleId'], 'status' => 'active']);
            MembershipBranch::insertForTenant(array_map(fn ($b) => ['membership_id' => $membership->id, 'branch_id' => $b], $branchIds));
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'membership.created',
                'entityType' => 'membership',
                'entityId' => $membership->id,
                'after' => [
                    'name' => $input['name'], 'email' => $input['email'], 'username' => $input['username'], 'roleId' => $input['roleId'],
                    'branchIds' => $input['branchIds'], 'existingUser' => $existing !== null,
                ],
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);

            return ['membershipId' => $membership->id, 'existingUser' => $existing !== null];
        }), 201);
    }

    public function update(Request $request, string $membershipId): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'roleId' => ['required', 'string', 'uuid'],
            'status' => ['required', 'string', 'in:active,inactive'],
            ...self::branchRules(),
        ], self::branchMessages());
        $branchIds = array_values(array_unique($input['branchIds']));

        DB::transaction(function () use ($actor, $membershipId, $input, $branchIds) {
            $this->entitlements->lockTenant($actor->tenantId);
            $target = Membership::whereKey($membershipId)->lockForUpdate()->first() ?? throw AppError::notFound('Empleado');
            $isSelf = $target->user_id === $actor->userId;
            if ($isSelf && $input['status'] === 'inactive') {
                throw AppError::conflict('SELF_DEACTIVATION', 'No podés desactivar tu propio usuario');
            }
            if ($isSelf && $input['roleId'] !== $target->role_id) {
                throw AppError::conflict('SELF_ROLE_CHANGE', 'No podés cambiar tu propio rol');
            }

            // Para modificar a alguien hay que tener todos los permisos de su rol actual y del nuevo.
            $this->assertCanAssignRole($actor, $target->role_id);
            if ($input['roleId'] !== $target->role_id) {
                $this->assertCanAssignRole($actor, $input['roleId']);
            }

            $currentRole = Role::find($target->role_id);
            $losesOwner = $currentRole?->is_system && $target->status === 'active'
                && ($input['status'] === 'inactive' || $input['roleId'] !== $target->role_id);
            if ($losesOwner) {
                $others = Membership::where('role_id', $target->role_id)->where('status', 'active')->whereKeyNot($membershipId)->count();
                if ($others === 0) {
                    throw AppError::conflict('LAST_OWNER', 'Debe quedar al menos un propietario activo');
                }
            }
            if ($target->status === 'inactive' && $input['status'] === 'active') {
                $this->entitlements->assertBelowLimit('max_users', Membership::where('status', 'active')->count());
            }

            $beforeBranches = MembershipBranch::where('membership_id', $membershipId)->pluck('branch_id')->sort()->values()->all();
            $before = ['roleId' => $target->role_id, 'status' => $target->status, 'branchIds' => $beforeBranches];
            $target->fill(['role_id' => $input['roleId'], 'status' => $input['status']])->save();
            MembershipBranch::where('membership_id', $membershipId)->delete();
            MembershipBranch::insertForTenant(array_map(fn ($b) => ['membership_id' => $membershipId, 'branch_id' => $b], $branchIds));
            $after = $input['branchIds'];
            sort($after);
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'membership.updated',
                'entityType' => 'membership',
                'entityId' => $membershipId,
                'before' => $before,
                'after' => ['roleId' => $input['roleId'], 'status' => $input['status'], 'branchIds' => $after],
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);
        });

        return $this->json(['ok' => true]);
    }

    /** Contraseña nueva para alguien que trabaja solo en este comercio (por ejemplo, sin email). */
    public function setPassword(Request $request, string $membershipId): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), ['password' => Input::passwordRules()], Input::passwordMessages('password'));
        $passwordHash = $this->passwords->hash($input['password']);

        DB::transaction(function () use ($actor, $membershipId, $passwordHash) {
            $target = Membership::whereKey($membershipId)->first() ?? throw AppError::notFound('Empleado');
            if ($target->user_id === $actor->userId) {
                throw AppError::conflict('SELF_PASSWORD', 'Tu contraseña se cambia desde Mi cuenta');
            }
            $this->assertCanAssignRole($actor, $target->role_id);
            if ($this->auth->usersOnlyIn($actor->tenantId, [$target->user_id]) === []) {
                throw AppError::conflict('USER_IN_OTHER_TENANTS', 'Esa persona también trabaja en otro comercio: tiene que cambiar su contraseña desde Mi cuenta o recuperarla por email');
            }
            $user = User::whereKey($target->user_id)->lockForUpdate()->firstOrFail();
            $user->forceFill(['password_hash' => $passwordHash, 'password_changed_at' => Carbon::now()])->save();
            $this->sessions->revokeAll($user->id);
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'membership.password_set',
                'entityType' => 'membership',
                'entityId' => $membershipId,
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);
        });

        return $this->json(['ok' => true]);
    }

    private function assertCanAssignRole(Actor $actor, string $roleId): void
    {
        if (! Role::whereKey($roleId)->exists()) {
            throw AppError::notFound('Rol');
        }
        $valid = array_flip(Catalog::permissionCodes());
        $codes = RolePermission::where('role_id', $roleId)->pluck('permission_code')->filter(fn ($c) => isset($valid[$c]));
        $actor->assertCanGrant($codes);
    }

    private static function branchRules(): array
    {
        return [
            'branchIds' => ['present', 'array', 'list', 'min:1', 'max:100'],
            'branchIds.*' => ['string', 'uuid'],
        ];
    }

    private static function branchMessages(): array
    {
        return ['branchIds.min' => 'Elegí al menos una sucursal'];
    }
}
