<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Auth\PlatformActor;
use App\Support\AppError;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

abstract class Controller
{
    /** Actor de comercio armado por AuthenticateUser. */
    protected function actor(Request $request): Actor
    {
        return $request->attributes->get('actor') ?? throw AppError::unauthenticated();
    }

    protected function platformActor(Request $request): PlatformActor
    {
        return $request->attributes->get('platformActor') ?? throw AppError::unauthenticated();
    }

    /**
     * Cuerpo JSON como arreglo. Un cuerpo que no es un objeto se trata como vacío y lo
     * rechaza la validación.
     *
     * @return array<string, mixed>
     */
    protected function body(Request $request): array
    {
        $data = $request->json()->all();

        return is_array($data) ? $data : [];
    }

    protected function json(mixed $data, int $status = 200): JsonResponse
    {
        return new JsonResponse($data, $status, [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** @return array{page: int, pageSize: int} */
    protected function pagination(Request $request): array
    {
        $q = Input::validate($request->query(), [
            'page' => ['nullable', 'integer', 'min:1'],
            'pageSize' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return ['page' => (int) ($q['page'] ?? 1), 'pageSize' => (int) ($q['pageSize'] ?? 25)];
    }
}
