<?php

namespace App\Auth;

use Illuminate\Http\Request;

/** Datos del cliente para auditoría y límites de intentos. */
final class Client
{
    public function __construct(
        public readonly string $ip,
        public readonly ?string $userAgent,
        public readonly string $requestId,
    ) {}

    public static function from(Request $request): self
    {
        $ua = $request->userAgent();

        return new self(
            $request->ip() ?? '0.0.0.0',
            $ua === null ? null : mb_substr($ua, 0, 300),
            (string) $request->attributes->get('requestId', ''),
        );
    }
}
