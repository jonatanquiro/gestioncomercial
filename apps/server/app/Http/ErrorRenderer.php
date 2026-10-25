<?php

namespace App\Http;

use App\Support\AppError;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

/** Manejo centralizado: todo error de la API sale con el formato { code, message, details, requestId }. */
final class ErrorRenderer
{
    /** Mensajes para claves únicas conocidas (MySQL informa el nombre de la clave en el error 1062). */
    private const UNIQUE_MESSAGES = [
        'users_email_uq' => 'Ese email ya está registrado',
        'tenants_cuit_active_uq' => 'Ya hay un comercio registrado con ese CUIT',
        'branches_tenant_name_uq' => 'Ya existe una sucursal con ese nombre',
        'roles_tenant_name_uq' => 'Ya existe un rol con ese nombre',
        'memberships_tenant_user_uq' => 'Esa persona ya es miembro del comercio',
    ];

    public static function render(Throwable $e, Request $request): JsonResponse
    {
        $requestId = (string) $request->attributes->get('requestId', '');
        [$status, $body] = self::map($e, $requestId);
        if ($status >= 500) {
            Log::error("req={$requestId} {$request->method()} {$request->path()}: ".$e->getMessage());
        }
        $response = new JsonResponse($body, $status, [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        // AssignRequestId no llega a ejecutarse después del error en algunas rutas (404 de ruteo).
        $response->headers->set('x-request-id', $requestId);
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }

    /** @return array{0: int, 1: array<string, mixed>} */
    private static function map(Throwable $e, string $requestId): array
    {
        if ($e instanceof AppError) {
            return [$e->status, self::body($e->errorCode, $e->getMessage(), $e->details, $requestId)];
        }
        if ($e instanceof ModelNotFoundException) {
            return [404, self::body('NOT_FOUND', 'Recurso no encontrado', null, $requestId)];
        }
        if ($e instanceof NotFoundHttpException) {
            return [404, self::body('NOT_FOUND', 'Ruta no encontrada', null, $requestId)];
        }
        if ($e instanceof MethodNotAllowedHttpException) {
            return [404, self::body('NOT_FOUND', 'Ruta no encontrada', null, $requestId)];
        }
        if ($e instanceof HttpExceptionInterface) {
            return [$e->getStatusCode(), self::body('HTTP_ERROR', $e->getMessage() ?: 'Solicitud inválida', null, $requestId)];
        }
        if ($e instanceof QueryException) {
            $driverCode = (int) ($e->errorInfo[1] ?? 0);
            $sqlState = (string) ($e->errorInfo[0] ?? '');
            if ($driverCode === 1062) {
                $key = preg_match("/for key '(?:[^'.]+\\.)?([^']+)'/", $e->getMessage(), $m) ? $m[1] : null;
                $message = ($key !== null ? (self::UNIQUE_MESSAGES[$key] ?? null) : null) ?? 'Ya existe un registro con esos datos';

                return [409, self::body('DUPLICATE', $message, ['constraint' => $key], $requestId)];
            }
            if ($driverCode === 1452) {
                // FK compuesta (tenant_id, id): un ID de otro comercio se ve como inexistente.
                Log::warning("Acceso a recurso inexistente o ajeno (1452) req={$requestId}");

                return [404, self::body('NOT_FOUND', 'Recurso no encontrado', null, $requestId)];
            }
            if ($sqlState === '45000') {
                return [403, self::body('FORBIDDEN', 'Operación no permitida', null, $requestId)];
            }
        }

        return [500, self::body('INTERNAL_ERROR', 'Ocurrió un error inesperado', null, $requestId)];
    }

    /** @return array<string, mixed> */
    private static function body(string $code, string $message, mixed $details, string $requestId): array
    {
        $body = ['code' => $code, 'message' => $message];
        if ($details !== null) {
            $body['details'] = $details;
        }
        $body['requestId'] = $requestId;

        return $body;
    }
}
