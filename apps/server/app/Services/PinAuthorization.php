<?php

namespace App\Services;

use App\Auth\Actor;
use App\Models\Membership;
use App\Models\RolePermission;
use App\Models\User;
use App\Support\AppError;
use App\Support\Throttle;

/**
 * Autorización en el momento (sección 6 del diseño): para una acción puntual que el cajero no
 * tiene permitida, un encargado elige su nombre e ingresa su PIN en la misma pantalla. Se
 * registran los dos: quien ejecutó y quien autorizó.
 */
class PinAuthorization
{
    public function __construct(private readonly PasswordService $passwords) {}

    /**
     * Devuelve null si el propio actor tiene el permiso, o el id de usuario de quien autorizó.
     *
     * @param  array{membershipId?: mixed, pin?: mixed}|null  $authorization
     */
    public function require(Actor $actor, string $permission, ?array $authorization): ?string
    {
        if ($actor->can($permission)) {
            return null;
        }
        if (! is_array($authorization) || ! is_string($authorization['membershipId'] ?? null) || ! is_string($authorization['pin'] ?? null)) {
            throw new AppError(403, 'AUTHORIZATION_REQUIRED', 'Esta acción necesita la autorización de un encargado', ['permission' => $permission]);
        }
        // Pocos intentos por cajero: un PIN de 4 a 6 dígitos no resiste prueba y error.
        Throttle::consume("pin:{$actor->tenantId}:{$actor->userId}", 5, 300);
        $membership = Membership::whereKey($authorization['membershipId'])->where('status', 'active')->first();
        $valid = $membership && $this->passwords->verify($membership->pos_pin_hash, $authorization['pin'])
            && RolePermission::where('role_id', $membership->role_id)->where('permission_code', $permission)->exists();
        if (! $valid) {
            throw new AppError(403, 'AUTHORIZATION_INVALID', 'El PIN no es correcto o esa persona no puede autorizar esta acción', ['permission' => $permission]);
        }
        Throttle::reset("pin:{$actor->tenantId}:{$actor->userId}");

        return $membership->user_id;
    }

    /** Personas que pueden autorizar el permiso (activas y con PIN cargado). @return list<array{membershipId: string, name: string}> */
    public function authorizers(string $permission): array
    {
        $roles = RolePermission::where('permission_code', $permission)->pluck('role_id');
        $members = Membership::whereIn('role_id', $roles)->where('status', 'active')->whereNotNull('pos_pin_hash')->get(['id', 'user_id']);
        $names = User::whereIn('id', $members->pluck('user_id'))->pluck('name', 'id');

        return $members->map(fn ($m) => ['membershipId' => $m->id, 'name' => $names[$m->user_id] ?? ''])->sortBy('name')->values()->all();
    }

    public function setPin(Actor $actor, string $password, string $pin): void
    {
        $user = User::find($actor->userId);
        if (! $this->passwords->verify($user?->password_hash, $password)) {
            throw AppError::badRequest('INVALID_PASSWORD', 'La contraseña no es correcta');
        }
        if (preg_match('/^(\d)\1+$/', $pin) || in_array($pin, ['1234', '12345', '123456', '4321', '654321'], true)) {
            throw AppError::validation([['path' => 'pin', 'message' => 'El PIN es demasiado fácil de adivinar']]);
        }
        $hash = defined('PASSWORD_ARGON2ID') ? password_hash($pin, PASSWORD_ARGON2ID) : password_hash($pin, PASSWORD_BCRYPT);
        Membership::whereKey($actor->membershipId)->update(['pos_pin_hash' => $hash]);
    }
}
