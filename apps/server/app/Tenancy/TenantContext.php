<?php

namespace App\Tenancy;

use Closure;

/**
 * Comercio activo del request. Lo fija el middleware de autenticación a partir de la sesión
 * (nunca del cuerpo ni de la URL) y lo leen el filtro automático de los modelos y la auditoría.
 */
class TenantContext
{
    private ?string $tenantId = null;

    private bool $bypass = false;

    public function set(?string $tenantId): void
    {
        $this->tenantId = $tenantId;
    }

    public function id(): ?string
    {
        return $this->tenantId;
    }

    public function bypassed(): bool
    {
        return $this->bypass;
    }

    /**
     * Ejecuta $fn con el comercio indicado como contexto y restaura el anterior.
     *
     * @template T
     *
     * @param  Closure(): T  $fn
     * @return T
     */
    public function run(string $tenantId, Closure $fn): mixed
    {
        [$prevTenant, $prevBypass] = [$this->tenantId, $this->bypass];
        $this->tenantId = $tenantId;
        $this->bypass = false;
        try {
            return $fn();
        } finally {
            [$this->tenantId, $this->bypass] = [$prevTenant, $prevBypass];
        }
    }

    /**
     * Acceso sin filtro por comercio. Solo para el panel de plataforma y procesos de sistema;
     * el CI rechaza su uso fuera de las carpetas permitidas (ver tests/Feature/IsolationTest).
     *
     * @template T
     *
     * @param  Closure(): T  $fn
     * @return T
     */
    public function withoutTenant(Closure $fn): mixed
    {
        [$prevTenant, $prevBypass] = [$this->tenantId, $this->bypass];
        $this->tenantId = null;
        $this->bypass = true;
        try {
            return $fn();
        } finally {
            [$this->tenantId, $this->bypass] = [$prevTenant, $prevBypass];
        }
    }
}
