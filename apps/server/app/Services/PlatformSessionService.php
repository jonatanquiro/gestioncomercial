<?php

namespace App\Services;

use App\Auth\Client;
use App\Auth\Cookies;
use App\Models\PlatformSession;
use App\Models\PlatformUser;
use App\Support\Tokens;
use Illuminate\Support\Carbon;

/** Sesiones del panel de plataforma: más cortas y separadas de las de comercios. */
class PlatformSessionService
{
    public function create(string $platformUserId, Client $client): string
    {
        $token = Tokens::random();
        $now = Carbon::now();
        PlatformSession::create([
            'platform_user_id' => $platformUserId,
            'token_hash' => Tokens::hash($token),
            'ip' => $client->ip,
            'user_agent' => $client->userAgent,
            'last_seen_at' => $now,
            'expires_at' => $now->copy()->addSeconds(Cookies::PLATFORM_MAX_SECONDS),
        ]);

        return $token;
    }

    /** @return array{session: PlatformSession, user: PlatformUser}|null */
    public function validate(string $token): ?array
    {
        $now = Carbon::now();
        $session = PlatformSession::where('token_hash', Tokens::hash($token))
            ->whereNull('revoked_at')
            ->where('expires_at', '>', $now)
            ->where('last_seen_at', '>', $now->copy()->subSeconds(Cookies::PLATFORM_IDLE_SECONDS))
            ->first();
        if (! $session) {
            return null;
        }
        $user = PlatformUser::where('id', $session->platform_user_id)->where('status', 'active')->first();
        if (! $user) {
            return null;
        }
        $session->forceFill(['last_seen_at' => $now])->save();

        return ['session' => $session, 'user' => $user];
    }

    public function revoke(string $sessionId): void
    {
        PlatformSession::where('id', $sessionId)->update(['revoked_at' => Carbon::now()]);
    }
}
