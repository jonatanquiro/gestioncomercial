<?php

namespace App\Support;

use RuntimeException;

/** Error de dominio con código estable para el cliente. Sale como { code, message, details, requestId }. */
class AppError extends RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly mixed $details = null,
    ) {
        parent::__construct($message);
    }

    /** @param  list<array{path: string, message: string}>  $details */
    public static function validation(array $details): self
    {
        return new self(400, 'VALIDATION_ERROR', 'Hay datos inválidos', $details);
    }

    public static function unauthenticated(): self
    {
        return new self(401, 'UNAUTHENTICATED', 'Iniciá sesión para continuar');
    }

    public static function invalidCredentials(): self
    {
        return new self(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos');
    }

    public static function forbidden(?string $permission = null): self
    {
        return new self(403, 'FORBIDDEN', 'No tenés permiso para realizar esta acción', $permission ? ['permission' => $permission] : null);
    }

    public static function csrf(): self
    {
        return new self(403, 'CSRF_INVALID', 'La sesión expiró o la solicitud no es válida. Recargá la página.');
    }

    public static function noTenant(): self
    {
        return new self(403, 'NO_ACTIVE_TENANT', 'No tenés un comercio activo seleccionado');
    }

    public static function tenantSuspended(): self
    {
        return new self(403, 'TENANT_SUSPENDED', 'El comercio está suspendido. Comunicate con soporte.');
    }

    public static function notFound(string $what = 'Recurso'): self
    {
        return new self(404, 'NOT_FOUND', "{$what} no encontrado");
    }

    public static function conflict(string $code, string $message): self
    {
        return new self(409, $code, $message);
    }

    public static function planLimit(string $limit, int $value): self
    {
        return new self(402, 'PLAN_LIMIT_REACHED', 'Alcanzaste el límite de tu plan', ['limit' => $limit, 'value' => $value]);
    }

    public static function tooManyRequests(): self
    {
        return new self(429, 'TOO_MANY_REQUESTS', 'Demasiados intentos. Esperá unos minutos.');
    }

    public static function badRequest(string $code, string $message): self
    {
        return new self(400, $code, $message);
    }
}
