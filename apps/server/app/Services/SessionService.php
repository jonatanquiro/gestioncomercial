<?php

namespace App\Services;

use App\Auth\Client;
use App\Auth\Cookies;
use App\Models\User;
use App\Models\UserSession;
use App\Support\Tokens;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/** Sesiones de usuarios de comercios: opacas, guardadas como hash y revocables. */
class SessionService
{
    /** @return array{id: string, token: string} */
    public function create(string $userId, ?string $tenantId, Client $client): array
    {
        $token = Tokens::random();
        $now = Carbon::now();
        $session = UserSession::create([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'token_hash' => Tokens::hash($token),
            'ip' => $client->ip,
            'user_agent' => $client->userAgent,
            'last_seen_at' => $now,
            'expires_at' => $now->copy()->addSeconds(Cookies::SESSION_MAX_SECONDS),
        ]);

        return ['id' => $session->id, 'token' => $token];
    }

    /** @return array{session: UserSession, user: User}|null */
    public function validate(string $token): ?array
    {
        $now = Carbon::now();
        $session = UserSession::where('token_hash', Tokens::hash($token))
            ->whereNull('revoked_at')
            ->where('expires_at', '>', $now)
            ->where('last_seen_at', '>', $now->copy()->subSeconds(Cookies::SESSION_IDLE_SECONDS))
            ->first();
        if (! $session) {
            return null;
        }
        $user = User::where('id', $session->user_id)->where('status', 'active')->first();
        if (! $user) {
            return null;
        }
        // Se actualiza cada 5 minutos para no escribir en cada request.
        if ($session->last_seen_at->lt($now->copy()->subMinutes(5))) {
            $session->forceFill(['last_seen_at' => $now])->save();
        }

        return ['session' => $session, 'user' => $user];
    }

    public function setTenant(string $sessionId, ?string $tenantId): void
    {
        UserSession::where('id', $sessionId)->update(['tenant_id' => $tenantId]);
    }

    public function revoke(string $sessionId, string $userId): bool
    {
        return UserSession::where('id', $sessionId)->where('user_id', $userId)->whereNull('revoked_at')
            ->update(['revoked_at' => Carbon::now()]) > 0;
    }

    public function revokeAll(string $userId, ?string $exceptSessionId = null): void
    {
        UserSession::where('user_id', $userId)->whereNull('revoked_at')
            ->when($exceptSessionId, fn ($q) => $q->where('id', '<>', $exceptSessionId))
            ->update(['revoked_at' => Carbon::now()]);
    }

    /** @return Collection<int, UserSession> */
    public function listActive(string $userId)
    {
        $now = Carbon::now();

        return UserSession::where('user_id', $userId)
            ->whereNull('revoked_at')
            ->where('expires_at', '>', $now)
            ->where('last_seen_at', '>', $now->copy()->subSeconds(Cookies::SESSION_IDLE_SECONDS))
            ->orderByDesc('last_seen_at')
            ->get();
    }
}
