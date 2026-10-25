<?php

namespace App\Providers;

use App\Services\CatalogSync;
use App\Tenancy\TenantContext;
use Illuminate\Database\Events\MigrationsEnded;
use Illuminate\Database\Events\NoPendingMigrations;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Un contexto de comercio por request (y por job), nunca compartido entre requests.
        $this->app->scoped(TenantContext::class);
    }

    public function boot(): void
    {
        // Después de migrar se sincronizan permisos, rubros y planes iniciales.
        // También sin migraciones pendientes: volver a correr `migrate` repara los catálogos.
        Event::listen([MigrationsEnded::class, NoPendingMigrations::class], function (MigrationsEnded|NoPendingMigrations $event) {
            if ($event->method === 'up' && Schema::hasTable('permissions')) {
                app(CatalogSync::class)->run();
            }
        });
    }
}
