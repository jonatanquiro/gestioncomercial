<?php

namespace App\Services;

use App\Models\Plan;
use App\Models\Subscription;
use App\Models\Tenant;
use App\Support\AppError;

/**
 * Único punto donde el núcleo pregunta por el plan. Los módulos comerciales no conocen
 * suscripciones ni cobros: solo consultan límites y funciones.
 */
class EntitlementsService
{
    /** @return array{code: string, name: string, limits: array<string, int>, features: list<string>}|null */
    public function plan(): ?array
    {
        $subscription = Subscription::where('status', '<>', 'cancelled')->first();
        $plan = $subscription ? Plan::with(['limits', 'features'])->find($subscription->plan_id) : null;
        if (! $plan) {
            return null;
        }

        return ['code' => $plan->code, 'name' => $plan->name, 'limits' => $plan->limitMap(), 'features' => $plan->featureList()];
    }

    /**
     * Bloquea la fila del comercio hasta el fin de la transacción. Se llama antes de contar
     * recursos para que dos altas simultáneas no superen juntas el límite.
     */
    public function lockTenant(string $tenantId): void
    {
        Tenant::whereKey($tenantId)->lockForUpdate()->first();
    }

    /** Lanza PLAN_LIMIT_REACHED si crear un recurso más superaría el límite. */
    public function assertBelowLimit(string $key, int $currentCount): void
    {
        $limit = $this->plan()['limits'][$key] ?? null;
        if ($limit !== null && $currentCount >= $limit) {
            throw AppError::planLimit($key, $limit);
        }
    }
}
