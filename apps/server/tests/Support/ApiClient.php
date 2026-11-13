<?php

namespace Tests\Support;

use Illuminate\Foundation\Testing\TestCase;

/**
 * Cliente HTTP de prueba con cookies, CSRF e IP propia (para no compartir límites de intentos).
 * Se comporta como el navegador: guarda las cookies que recibe y manda el header x-csrf-token.
 */
final class ApiClient
{
    /** @var array<string, string> */
    public array $cookies = [];

    public readonly string $ip;

    public function __construct(private readonly TestCase $test)
    {
        $this->ip = sprintf('10.%d.%d.%d', random_int(0, 255), random_int(0, 255), random_int(1, 254));
    }

    public function request(string $method, string $url, ?array $body = null, bool $csrf = true): ApiResponse
    {
        $server = ['REMOTE_ADDR' => $this->ip, 'HTTP_ACCEPT' => 'application/json', 'HTTP_USER_AGENT' => 'phpunit'];
        if ($body !== null) {
            $server['CONTENT_TYPE'] = 'application/json';
        }
        if ($csrf && $method !== 'GET' && isset($this->cookies['gc_csrf'])) {
            $server['HTTP_X_CSRF_TOKEN'] = $this->cookies['gc_csrf'];
        }
        $content = $body === null ? null : json_encode((object) $body, JSON_UNESCAPED_UNICODE);
        $response = $this->test->call($method, '/api/v1'.$url, [], $this->cookies, [], $server, $content);
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getValue() === '' || $cookie->getValue() === null || ($cookie->getExpiresTime() !== 0 && $cookie->getExpiresTime() < time())) {
                unset($this->cookies[$cookie->getName()]);
            } else {
                $this->cookies[$cookie->getName()] = $cookie->getValue();
            }
        }
        $decoded = json_decode((string) $response->getContent(), true);

        return new ApiResponse($response->getStatusCode(), $decoded, $response->headers->all(), $response->headers->getCookies());
    }

    public function get(string $url): ApiResponse
    {
        return $this->request('GET', $url);
    }

    public function post(string $url, array $body = [], bool $csrf = true): ApiResponse
    {
        return $this->request('POST', $url, $body, $csrf);
    }

    public function put(string $url, array $body = []): ApiResponse
    {
        return $this->request('PUT', $url, $body);
    }

    public function delete(string $url): ApiResponse
    {
        return $this->request('DELETE', $url);
    }
}
