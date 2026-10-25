<?php

use App\Http\Controllers\AuditController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BranchesController;
use App\Http\Controllers\EmployeesController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\PlatformController;
use App\Http\Controllers\RolesController;
use App\Http\Controllers\TenantController;
use Illuminate\Support\Facades\Route;

/*
| Rutas de /api/v1. Por defecto todo exige sesión y, en las mutaciones, el token CSRF de doble
| envío. Las rutas públicas son la excepción explícita (grupo "public"). Las que tocan datos
| del comercio declaran perm:... con códigos de packages/contracts/src/permissions.ts;
| PermissionsTest recorre este archivo y falla si una ruta queda sin protección.
*/

Route::pattern('id', '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');
Route::pattern('membershipId', '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');

// ---------------------------------------------------------------- Públicas
Route::get('health', [HealthController::class, 'show'])->name('public.health');
Route::get('business-types', [AuthController::class, 'businessTypes'])->name('public.business-types');
Route::post('auth/register', [AuthController::class, 'register'])->name('public.register');
Route::post('auth/login', [AuthController::class, 'login'])->name('public.login');
Route::post('auth/forgot-password', [AuthController::class, 'forgotPassword'])->name('public.forgot-password');
Route::post('auth/reset-password', [AuthController::class, 'resetPassword'])->name('public.reset-password');
Route::post('platform/auth/login', [PlatformController::class, 'login'])->name('public.platform-login');

// ---------------------------------------------------------------- Sesión propia (sin comercio obligatorio)
// Cerrar sesión no exige CSRF: el peor caso es que alguien cierre tu sesión.
Route::post('auth/logout', [AuthController::class, 'logout'])->middleware('auth.user:any');

Route::middleware(['csrf.double', 'auth.user:any'])->group(function () {
    Route::get('auth/me', [AuthController::class, 'me']);
    Route::post('auth/switch-tenant', [AuthController::class, 'switchTenant']);
    Route::post('auth/change-password', [AuthController::class, 'changePassword']);
    Route::get('auth/sessions', [AuthController::class, 'sessions']);
    Route::delete('auth/sessions/{id}', [AuthController::class, 'revokeSession']);
});

// ---------------------------------------------------------------- Comercio activo
Route::middleware(['csrf.double', 'auth.user'])->group(function () {
    // Datos generales del comercio y sus sucursales: visibles para todo miembro activo.
    Route::get('tenant', [TenantController::class, 'show']);
    Route::put('tenant', [TenantController::class, 'update'])->middleware('perm:settings.manage');

    Route::get('branches', [BranchesController::class, 'index']);
    Route::post('branches', [BranchesController::class, 'store'])->middleware('perm:branches.manage');
    Route::put('branches/{id}', [BranchesController::class, 'update'])->middleware('perm:branches.manage');

    Route::get('roles', [RolesController::class, 'index'])->middleware('perm:roles.manage,users.manage');
    Route::post('roles', [RolesController::class, 'store'])->middleware('perm:roles.manage');
    Route::put('roles/{id}', [RolesController::class, 'update'])->middleware('perm:roles.manage');
    Route::delete('roles/{id}', [RolesController::class, 'destroy'])->middleware('perm:roles.manage');

    Route::middleware('perm:users.manage')->group(function () {
        Route::get('employees', [EmployeesController::class, 'index']);
        Route::post('employees', [EmployeesController::class, 'store']);
        Route::put('employees/{membershipId}', [EmployeesController::class, 'update']);
    });

    Route::get('audit', [AuditController::class, 'index'])->middleware('perm:audit.read');
});

// ---------------------------------------------------------------- Panel de plataforma
Route::prefix('platform')->middleware(['csrf.double', 'auth.platform'])->group(function () {
    Route::post('auth/logout', [PlatformController::class, 'logout']);
    Route::get('auth/me', [PlatformController::class, 'me']);
    Route::get('tenants', [PlatformController::class, 'tenants']);
    Route::post('tenants', [PlatformController::class, 'createTenant']);
    Route::post('tenants/{id}/status', [PlatformController::class, 'setTenantStatus']);
    Route::get('plans', [PlatformController::class, 'plans']);
    Route::put('plans/{id}', [PlatformController::class, 'updatePlan']);
    Route::get('audit', [PlatformController::class, 'audit']);
});
