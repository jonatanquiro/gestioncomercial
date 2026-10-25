<?php

namespace Tests\Support;

final class ApiResponse
{
    /**
     * @param  array<string, list<string|null>>  $headers
     * @param  list<\Symfony\Component\HttpFoundation\Cookie>  $cookies
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
