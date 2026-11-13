<?php

namespace Tests\Support;

use Illuminate\Routing\Route;

/** Registro de rutas de /api/v1 para recorrerlas en las pruebas de permisos y aislamiento. */
final class Routes
{
    /** @return list<array{method: string, path: string, public: bool, platform: bool, permissions: list<string>}> */
    public static function api(): array
    {
        $list = [];
        /** @var Route $route */
        foreach (app('router')->getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'api/v1/')) {
                continue;
            }
            $permissions = [];
            foreach ($route->gatherMiddleware() as $m) {
                if (is_string($m) && str_starts_with($m, 'perm:')) {
                    array_push($permissions, ...explode(',', substr($m, 5)));
                }
            }
            foreach ($route->methods() as $method) {
                if ($method === 'HEAD') {
                    continue;
                }
                $list[] = [
                    'method' => $method,
                    'path' => '/'.substr($uri, strlen('api/v1/')),
                    'public' => str_starts_with((string) $route->getName(), 'public.'),
                    'platform' => str_starts_with($uri, 'api/v1/platform/'),
                    'permissions' => $permissions,
                ];
            }
        }

        return $list;
    }

    public static function fill(string $path, string $id): string
    {
        return preg_replace('/\{[^}]+\}/', $id, $path);
    }
}
