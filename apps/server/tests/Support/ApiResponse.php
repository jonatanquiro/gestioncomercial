<?php

namespace Tests\Support;

use Symfony\Component\HttpFoundation\Cookie;

final class ApiResponse
{
    /**
     * @param  array<string, list<string|null>>  $headers
     * @param  list<Cookie>  $cookies
     */
    public function __construct(
        public readonly int $status,
        public readonly mixed $body,
        public readonly array $headers,
        public readonly array $cookies,
    ) {}

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)][0] ?? null;
    }
}
