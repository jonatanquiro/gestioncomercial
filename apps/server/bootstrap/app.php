<?php

use App\Http\ErrorRenderer;
use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\AuthenticatePlatform;
use App\Http\Middleware\AuthenticateUser;
use App\Http\Middleware\RequirePermission;
use App\Http\Middleware\SecurityHeaders;
use App\Http\Middleware\VerifyDoubleSubmitCsrf;
use App\Support\AppError;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api/v1',
        commands: __DIR__.'/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend(AssignRequestId::class);
        $middleware->append(SecurityHeaders::class);
        // Las contraseñas y los tokens se reciben tal cual: un espacio es parte de la contraseña.
        $middleware->trimStrings(except: ['password', 'ownerPassword', 'currentPassword', 'newPassword', 'token']);
        // Las cookies de sesión y CSRF son tokens aleatorios opacos; no se cifran con APP_KEY.
        $middleware->encryptCookies(except: ['gc_session', 'gc_psession', 'gc_csrf']);
        $middleware->alias([
            'auth.user' => AuthenticateUser::class,
            'auth.platform' => AuthenticatePlatform::class,
            'perm' => RequirePermission::class,
            'csrf.double' => VerifyDoubleSubmitCsrf::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontReportDuplicates();
        $exceptions->dontFlash(['ownerPassword']);
        $exceptions->dontFlash(['privateKeyPem', 'certificatePem']);
        // Todo error de la API sale con el formato { code, message, details, requestId }.
        $exceptions->render(function (Throwable $e, Request $request) {
            if ($request->is('api/*')) {
                return ErrorRenderer::render($e, $request);
            }

            return null;
        });
        $exceptions->dontReport([AppError::class]);
    })->create();
