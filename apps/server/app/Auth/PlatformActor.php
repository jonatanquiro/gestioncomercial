<?php

namespace App\Auth;

final class PlatformActor
{
    public function __construct(
        public readonly string $platformUserId,
        public readonly string $name,
        public readonly string $sessionId,
        public readonly string $ip,
        public readonly string $requestId,
    ) {}
}
