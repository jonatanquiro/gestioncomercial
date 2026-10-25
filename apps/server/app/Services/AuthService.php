<?php

namespace App\Services;

use App\Auth\Actor;
use App\Auth\Client;
use App\Mail\PasswordResetMail;
use App\Models\BusinessType;
use App\Models\Membership;
use App\Models\PasswordResetToken;
use App\Models\User;
use App\Models\UserSession;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Throttle;
use App\Support\Tokens;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * Identidad: registro, ingreso, recuperación y cambio de contraseña, comercio activo.
 * La identidad es global (un usuario puede pertenecer a varios comercios); las consultas
 * de membresías del propio usuario se hacen sin filtro de comercio pero siempre por user_id.
 */
class AuthService
{
    private const MIN = 60;

    private const RESET_TOKEN_TTL_SECONDS = 30 * self::MIN;

    public function __construct(
        private readonly PasswordService $passwords,
        private readonly SessionService $sessions,
        private readonly ProvisioningService $provisioning,
        private readonly AuditService $audit,
    ) {}

    /** @return list<array{code: string, name: string}> */
    public function businessTypes(): array
    {
        return BusinessType::orderBy('sort_order')->get(['code', 'name'])
            ->map(fn (BusinessType $b) => ['code' => $b->code, 'name' => $b->name])->all();
    }

    /**
     * Registro de un comercio nuevo con su propietario, todo en una transacción.
     *
     * @param  array<string, mixed>  $input  validado
     * @return array{id: string, token: string}
     */
    public function register(array $input, Client $client): array
    {
        Throttle::consume("register:{$client->ip}", 10, 60 * self::MIN);
        $passwordHash = $this->passwords->hash($input['password']);

        return DB::transaction(function () use ($input, $passwordHash, $client) {
            if (User::where('email', $input['email'])->exists()) {
                throw AppError::conflict('EMAIL_IN_USE', 'Ese email ya está registrado. Iniciá sesión o recuperá tu contraseña.');
            }
            $user = User::create([
                'email' => $input['email'],
                'name' => $input['ownerName'],
                'password_hash' => $passwordHash,
                'password_changed_at' => Carbon::now(),
            ]);
            $tenantId = $this->provisioning->create($user->id, $user->name, $input, $client);

            return $this->sessions->create($user->id, $tenantId, $client);
        });
    }

    /** @return array{id: string, token: string} */
    public function login(string $email, string $password, Client $client): array
    {
        $key = "login:{$client->ip}:{$email}";
        Throttle::consume($key, 10, 15 * self::MIN);
        Throttle::consume("login-ip:{$client->ip}", 50, 15 * self::MIN);

        $user = User::where('email', $email)->first();
        $ok = $this->passwords->verify($user?->status === 'active' ? $user->password_hash : null, $password);
        if (! $user || ! $ok) {
            $this->audit->record([
                'tenantId' => null,
                'actorType' => 'user',
                'actorId' => $user?->id,
                'actorName' => null,
                'action' => 'auth.login_failed',
                'entityType' => 'user',
                'entityId' => $user?->id,
                'after' => ['email' => $email],
                'ip' => $client->ip,
                'requestId' => $client->requestId,
            ]);
            throw AppError::invalidCredentials();
        }
        Throttle::reset($key);

        $tenantId = $this->defaultTenant($user->id);

        return DB::transaction(function () use ($user, $tenantId, $client) {
            $session = $this->sessions->create($user->id, $tenantId, $client);
            if ($tenantId) {
                $this->audit->record([
                    'tenantId' => $tenantId,
                    'actorType' => 'user',
                    'actorId' => $user->id,
                    'actorName' => $user->name,
                    'action' => 'auth.login',
                    'entityType' => 'session',
                    'entityId' => $session['id'],
                    'ip' => $client->ip,
                    'requestId' => $client->requestId,
                ]);
            }

            return $session;
        });
    }

    public function logout(Actor $actor): void
    {
        $this->sessions->revoke($actor->sessionId, $actor->userId);
    }

    /** Siempre responde igual, exista o no el email, para no revelar cuentas. */
    public function forgotPassword(string $email, Client $client): void
    {
        Throttle::consume("forgot-ip:{$client->ip}", 5, 15 * self::MIN);
        if (! Throttle::attempt("forgot:{$email}", 3, 60 * self::MIN)) {
            return;
        }
        $token = Tokens::random();
        $user = DB::transaction(function () use ($email, $token) {
            $user = User::where('email', $email)->where('status', 'active')->first();
            if ($user) {
                PasswordResetToken::create([
                    'user_id' => $user->id,
                    'token_hash' => Tokens::hash($token),
                    'expires_at' => Carbon::now()->addSeconds(self::RESET_TOKEN_TTL_SECONDS),
                ]);
            }

            return $user;
        });
        if (! $user) {
            return;
        }
        $link = rtrim((string) config('app.url'), '/').'/restablecer?token='.rawurlencode($token);
        Mail::to($user->email)->send(new PasswordResetMail($user->name, $link));
    }

    public function resetPassword(string $token, string $password, Client $client): void
    {
        Throttle::consume("reset-ip:{$client->ip}", 10, 15 * self::MIN);
        $passwordHash = $this->passwords->hash($password);
        DB::transaction(function () use ($token, $passwordHash, $client) {
            $row = PasswordResetToken::where('token_hash', Tokens::hash($token))
                ->whereNull('used_at')
                ->where('expires_at', '>', Carbon::now())
                ->lockForUpdate()
                ->first();
            $user = $row ? User::where('id', $row->user_id)->where('status', 'active')->lockForUpdate()->first() : null;
            if (! $row || ! $user) {
                throw AppError::badRequest('RESET_TOKEN_INVALID', 'El enlace venció o ya fue usado. Pedí uno nuevo.');
            }
            $now = Carbon::now();
            $row->forceFill(['used_at' => $now])->save();
            $user->forceFill(['password_hash' => $passwordHash, 'password_changed_at' => $now])->save();
            $this->sessions->revokeAll($user->id);
            $this->audit->record([
                'tenantId' => null,
                'actorType' => 'user',
                'actorId' => $user->id,
                'actorName' => null,
                'action' => 'auth.password_reset',
                'entityType' => 'user',
                'entityId' => $user->id,
                'ip' => $client->ip,
                'requestId' => $client->requestId,
            ]);
        });
    }

    public function changePassword(Actor $actor, string $currentPassword, string $newPassword): void
    {
        Throttle::consume("change-pw:{$actor->userId}", 10, 15 * self::MIN);
        $user = User::findOrFail($actor->userId);
        if (! $this->passwords->verify($user->password_hash, $currentPassword)) {
            throw AppError::badRequest('INVALID_PASSWORD', 'La contraseña actual no es correcta');
        }
        $passwordHash = $this->passwords->hash($newPassword);
        DB::transaction(function () use ($actor, $user, $passwordHash) {
            $user->forceFill(['password_hash' => $passwordHash, 'password_changed_at' => Carbon::now()])->save();
            $this->sessions->revokeAll($actor->userId, $actor->sessionId);
            $this->audit->record([
                'tenantId' => null,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'auth.password_changed',
                'entityType' => 'user',
                'entityId' => $actor->userId,
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);
        });
    }

    public function switchTenant(Actor $actor, string $tenantId): void
    {
        $allowed = $this->userMemberships($actor->userId)
            ->where('memberships.tenant_id', $tenantId)
            ->where('memberships.status', 'active')
            ->exists();
        if (! $allowed) {
            throw AppError::notFound('Comercio');
        }
        DB::transaction(function () use ($actor, $tenantId) {
            $this->sessions->setTenant($actor->sessionId, $tenantId);
            $this->audit->record([
                'tenantId' => $tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'auth.tenant_selected',
                'entityType' => 'session',
                'entityId' => $actor->sessionId,
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);
        });
    }

    /** Forma de MeResponse (packages/contracts/src/api-types.ts). */
    public function me(Actor $actor): array
    {
        $user = User::findOrFail($actor->userId);
        $list = $this->userMemberships($actor->userId)
            ->join('roles', function ($join) {
                $join->on('roles.tenant_id', '=', 'memberships.tenant_id')->on('roles.id', '=', 'memberships.role_id');
            })
            ->orderBy('tenants.trade_name')
            ->get([
                'memberships.tenant_id', 'tenants.trade_name', 'tenants.status as tenant_status', 'tenants.business_type_code',
                'roles.id as role_id', 'roles.name as role_name', 'memberships.status',
            ]);
        $current = $list->first(fn ($m) => $m->tenant_id === $actor->tenantId && $m->status === 'active');

        return [
            'user' => ['id' => $user->id, 'name' => $user->name, 'email' => $user->email],
            'tenant' => $current ? [
                'id' => $current->tenant_id,
                'tradeName' => $current->trade_name,
                'status' => $current->tenant_status,
                'businessTypeCode' => $current->business_type_code,
            ] : null,
            'role' => $current ? ['id' => $current->role_id, 'name' => $current->role_name] : null,
            'permissions' => $current ? $actor->permissionList() : [],
            'branchIds' => $current ? $actor->branchIds : [],
            'memberships' => $list->map(fn ($m) => [
                'tenantId' => $m->tenant_id,
                'tenantName' => $m->trade_name,
                'roleName' => $m->role_name,
                'status' => $m->status,
                'tenantStatus' => $m->tenant_status,
            ])->values()->all(),
        ];
    }

    /** @return list<array<string, mixed>> forma de SessionDto */
    public function listSessions(Actor $actor): array
    {
        return $this->sessions->listActive($actor->userId)->map(fn (UserSession $s) => [
            'id' => $s->id,
            'createdAt' => Dates::iso($s->created_at),
            'lastSeenAt' => Dates::iso($s->last_seen_at),
            'ip' => $s->ip,
            'userAgent' => $s->user_agent,
            'current' => $s->id === $actor->sessionId,
        ])->values()->all();
    }

    public function revokeSession(Actor $actor, string $sessionId): void
    {
        if (! $this->sessions->revoke($sessionId, $actor->userId)) {
            throw AppError::notFound('Sesión');
        }
    }

    private function defaultTenant(string $userId): ?string
    {
        return $this->userMemberships($userId)
            ->where('memberships.status', 'active')
            ->orderBy('memberships.created_at')
            ->value('memberships.tenant_id');
    }

    /**
     * Membresías del propio usuario en comercios no dados de baja. Es el único lugar fuera
     * del panel de plataforma que consulta sin filtro de comercio, y siempre por user_id.
     */
    private function userMemberships(string $userId): Builder
    {
        return Membership::withoutGlobalScope('tenant')
            ->join('tenants', 'tenants.id', '=', 'memberships.tenant_id')
            ->where('memberships.user_id', $userId)
            ->where('tenants.status', '<>', 'cancelled');
    }
}
