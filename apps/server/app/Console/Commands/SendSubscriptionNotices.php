<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\BillingService;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Tarea diaria del cobro (ADR 0012): revisa en Mercado Pago los pagos pendientes y manda los
 * avisos de vencimiento. Se corre una vez por día desde el cron del hosting.
 */
class SendSubscriptionNotices extends Command
{
    protected $signature = 'subscriptions:remind';

    protected $description = 'Revisa pagos pendientes y envía los avisos de vencimiento de las suscripciones';

    public function handle(BillingService $billing, TenantContext $context): int
    {
        $sent = 0;
        $failed = 0;
        foreach (Tenant::whereNotIn('status', ['suspended', 'cancelled'])->orderBy('id')->lazyById(100) as $tenant) {
            try {
                $stage = $context->run($tenant->id, function () use ($billing) {
                    $billing->reconcilePending();

                    return $billing->sendNotice();
                });
                if ($stage !== null) {
                    $sent++;
                    $this->line("{$tenant->trade_name}: aviso {$stage}");
                }
            } catch (Throwable $e) {
                // Un comercio con problemas no frena a los demás.
                $failed++;
                Log::error("subscriptions:remind falló en el comercio {$tenant->id}: {$e->getMessage()}");
            }
        }
        $this->info("Avisos enviados: {$sent}".($failed ? " · comercios con error: {$failed} (ver el registro)" : ''));

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
