<?php

use App\Http\Controllers\AuditController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BranchesController;
use App\Http\Controllers\CashController;
use App\Http\Controllers\CategoriesController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\EmployeesController;
use App\Http\Controllers\FiscalController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\PaymentMethodsController;
use App\Http\Controllers\PaymentsController;
use App\Http\Controllers\PlatformController;
use App\Http\Controllers\PosController;
use App\Http\Controllers\PricesController;
use App\Http\Controllers\ProductsController;
use App\Http\Controllers\RolesController;
use App\Http\Controllers\SalesController;
use App\Http\Controllers\SettlementsController;
use App\Http\Controllers\StockController;
use App\Http\Controllers\StockCountsController;
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
    Route::put('auth/username', [AuthController::class, 'updateUsername']);
    Route::get('auth/sessions', [AuthController::class, 'sessions']);
    Route::delete('auth/sessions/{id}', [AuthController::class, 'revokeSession']);
});

// ---------------------------------------------------------------- Comercio activo
Route::middleware(['csrf.double', 'auth.user'])->group(function () {
    // Datos generales del comercio y sus sucursales: visibles para todo miembro activo.
    Route::get('tenant', [TenantController::class, 'show']);
    Route::put('tenant', [TenantController::class, 'update'])->middleware('perm:settings.manage');
    Route::put('tenant/appearance', [TenantController::class, 'appearance'])->middleware('perm:settings.manage');
    Route::get('fiscal/settings', [FiscalController::class, 'settings'])->middleware('perm:fiscal.manage');
    Route::put('fiscal/settings', [FiscalController::class, 'save'])->middleware('perm:fiscal.manage');
    Route::post('fiscal/csr', [FiscalController::class, 'csr'])->middleware('perm:fiscal.manage');
    Route::post('fiscal/check', [FiscalController::class, 'check'])->middleware('perm:fiscal.manage');
    Route::get('fiscal/status', [FiscalController::class, 'status'])->middleware('perm:fiscal.manage,fiscal.issue');
    Route::get('fiscal/invoices', [FiscalController::class, 'invoices'])->middleware('perm:fiscal.manage,fiscal.issue');
    Route::post('sales/{id}/invoice', [FiscalController::class, 'issue'])->middleware('perm:fiscal.manage,fiscal.issue');
    Route::get('payments', [PaymentsController::class, 'index'])->middleware('perm:cash.read_all');
    Route::get('dashboard/today', [DashboardController::class, 'today'])->middleware('perm:sales.read_own,sales.read_all,cash.read_all,stock.read');
    Route::get('settlements', [SettlementsController::class, 'index'])->middleware('perm:cash.read_all');
    Route::post('settlements', [SettlementsController::class, 'store'])->middleware('perm:cash.read_all');
    Route::get('settlements/{id}', [SettlementsController::class, 'show'])->middleware('perm:cash.read_all');
    Route::post('settlements/{id}/refresh', [SettlementsController::class, 'refresh'])->middleware('perm:cash.read_all');
    Route::post('settlements/{id}/import', [SettlementsController::class, 'import'])->middleware('perm:cash.read_all');
    Route::post('settlements/{id}/review', [SettlementsController::class, 'review'])->middleware('perm:cash.read_all');
    Route::post('settlements/{id}/match', [SettlementsController::class, 'match'])->middleware('perm:cash.read_all');
    Route::post('settlements/{id}/close', [SettlementsController::class, 'close'])->middleware('perm:cash.read_all');

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
        Route::put('employees/{membershipId}/password', [EmployeesController::class, 'setPassword']);
    });

    Route::get('audit', [AuditController::class, 'index'])->middleware('perm:audit.read');

    // Catálogo
    Route::get('categories', [CategoriesController::class, 'index'])->middleware('perm:products.read');
    Route::post('categories', [CategoriesController::class, 'store'])->middleware('perm:products.update');
    Route::put('categories/{id}', [CategoriesController::class, 'update'])->middleware('perm:products.update');
    Route::get('brands', [CategoriesController::class, 'brands'])->middleware('perm:products.read');
    Route::post('brands', [CategoriesController::class, 'storeBrand'])->middleware('perm:products.create,products.update');

    Route::get('products', [ProductsController::class, 'index'])->middleware('perm:products.read');
    Route::get('products/lookup', [ProductsController::class, 'lookup'])->middleware('perm:products.read');
    Route::get('products/favorites', [ProductsController::class, 'favorites'])->middleware('perm:products.read');
    Route::get('products/reference', [ProductsController::class, 'reference'])->middleware('perm:products.create');
    Route::get('products/reference/search', [ProductsController::class, 'referenceSearch'])->middleware('perm:products.create');
    Route::post('products/reference/add', [ProductsController::class, 'addFromReference'])->middleware('perm:products.create');
    Route::post('products', [ProductsController::class, 'store'])->middleware('perm:products.create');
    Route::get('products/{id}', [ProductsController::class, 'show'])->middleware('perm:products.read');
    Route::get('products/{id}/history', [ProductsController::class, 'history'])->middleware('perm:products.read');
    Route::put('products/{id}', [ProductsController::class, 'update'])->middleware('perm:products.update');
    Route::post('products/{id}/status', [ProductsController::class, 'setStatus'])->middleware('perm:products.deactivate');

    Route::post('prices/bulk/preview', [PricesController::class, 'preview'])->middleware('perm:prices.bulk_update');
    Route::post('prices/bulk/apply', [PricesController::class, 'apply'])->middleware('perm:prices.bulk_update');

    // Inventario
    Route::get('warehouses', [StockController::class, 'warehouses'])->middleware('perm:stock.read');
    Route::get('stock', [StockController::class, 'index'])->middleware('perm:stock.read');
    Route::get('stock/movements', [StockController::class, 'movements'])->middleware('perm:stock.read');
    Route::post('stock/adjustments', [StockController::class, 'adjust'])->middleware('perm:stock.adjust');
    Route::post('stock/waste', [StockController::class, 'waste'])->middleware('perm:stock.waste');

    Route::middleware('perm:stock.count')->group(function () {
        Route::get('stock-counts', [StockCountsController::class, 'index']);
        Route::post('stock-counts', [StockCountsController::class, 'store']);
        Route::get('stock-counts/{id}', [StockCountsController::class, 'show']);
        Route::put('stock-counts/{id}/lines', [StockCountsController::class, 'lines']);
        Route::post('stock-counts/{id}/close', [StockCountsController::class, 'close']);
        Route::post('stock-counts/{id}/cancel', [StockCountsController::class, 'cancel']);
    });

    // Cajas, medios de pago y turnos
    Route::get('registers', [CashController::class, 'registers'])->middleware('perm:sales.create,cash.open,cash.read_all,branches.manage');
    Route::post('registers', [CashController::class, 'storeRegister'])->middleware('perm:branches.manage');
    Route::put('registers/{id}', [CashController::class, 'updateRegister'])->middleware('perm:branches.manage');

    Route::get('payment-methods', [PaymentMethodsController::class, 'index'])->middleware('perm:sales.create,settings.manage,cash.read_all');
    Route::post('payment-methods', [PaymentMethodsController::class, 'store'])->middleware('perm:settings.manage');
    Route::put('payment-methods/{id}', [PaymentMethodsController::class, 'update'])->middleware('perm:settings.manage');

    Route::get('shifts', [CashController::class, 'shifts'])->middleware('perm:cash.open,cash.close,cash.count,cash.read_all');
    Route::post('shifts', [CashController::class, 'openShift'])->middleware('perm:cash.open');
    Route::get('shifts/{id}', [CashController::class, 'showShift'])->middleware('perm:cash.open,cash.close,cash.count,cash.read_all');
    Route::post('shifts/{id}/movements', [CashController::class, 'movement'])->middleware('perm:cash.withdraw,cash.deposit');
    Route::post('shifts/{id}/counts', [CashController::class, 'count'])->middleware('perm:cash.count');
    Route::post('shifts/{id}/close', [CashController::class, 'close'])->middleware('perm:cash.close');

    // Ventas. Anular y devolver llegan también a quien vende: sin el permiso, piden el PIN de un encargado.
    Route::post('sales', [SalesController::class, 'store'])->middleware('perm:sales.create');
    Route::get('sales', [SalesController::class, 'index'])->middleware('perm:sales.read_own,sales.read_all');
    Route::get('sales/{id}', [SalesController::class, 'show'])->middleware('perm:sales.read_own,sales.read_all');
    Route::post('sales/{id}/void', [SalesController::class, 'void'])->middleware('perm:sales.create,sales.void');
    Route::post('sales/{id}/returns', [SalesController::class, 'storeReturn'])->middleware('perm:sales.create,sales.return');
    Route::get('pos/authorizers', [PosController::class, 'authorizers'])->middleware('perm:sales.create');
    Route::post('auth/pos-pin', [PosController::class, 'setPin']);
});

// ---------------------------------------------------------------- Panel de plataforma
Route::prefix('platform')->middleware(['csrf.double', 'auth.platform'])->group(function () {
    Route::post('auth/logout', [PlatformController::class, 'logout']);
    Route::get('auth/me', [PlatformController::class, 'me']);
    Route::get('tenants', [PlatformController::class, 'tenants']);
    Route::post('tenants', [PlatformController::class, 'createTenant']);
    Route::post('tenants/{id}/status', [PlatformController::class, 'setTenantStatus']);
    Route::post('tenants/{id}/plan', [PlatformController::class, 'changeTenantPlan']);
    Route::get('plans', [PlatformController::class, 'plans']);
    Route::put('plans/{id}', [PlatformController::class, 'updatePlan']);
    Route::get('audit', [PlatformController::class, 'audit']);
});
