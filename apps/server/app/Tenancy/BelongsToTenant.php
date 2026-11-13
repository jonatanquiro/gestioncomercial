<?php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Builder;
use LogicException;

/**
 * Reemplazo de RLS en MySQL (sección 0 del diseño). Todo modelo con tenant_id usa este trait:
 * - cada consulta se filtra por el comercio del contexto;
 * - al crear, completa tenant_id y rechaza un tenant_id distinto del contexto;
 * - sin comercio en contexto, la consulta lanza MissingTenantContext en lugar de devolver todo.
 * IsolationTest falla si un modelo con tenant_id no usa el trait.
 */
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope('tenant', function (Builder $query) {
            $context = app(TenantContext::class);
            if ($context->bypassed()) {
                return;
            }
            $tenantId = $context->id();
            if ($tenantId === null) {
                throw new MissingTenantContext('Consulta a '.$query->getModel()->getTable().' sin comercio en contexto');
            }
            $query->where($query->getModel()->qualifyColumn('tenant_id'), $tenantId);
        });

        static::creating(function ($model) {
            $context = app(TenantContext::class);
            $tenantId = $context->id();
            if ($tenantId === null) {
                if ($context->bypassed() && $model->tenant_id) {
                    return;
                }
                throw new MissingTenantContext('Alta en '.$model->getTable().' sin comercio en contexto');
            }
            if ($model->tenant_id && $model->tenant_id !== $tenantId) {
                throw new LogicException('Se intentó crear una fila de otro comercio en '.$model->getTable());
            }
            $model->tenant_id = $tenantId;
        });

        static::updating(function ($model) {
            if ($model->isDirty('tenant_id')) {
                throw new LogicException('No se puede mover una fila de '.$model->getTable().' a otro comercio');
            }
        });
    }

    /**
     * Alta masiva en una sola consulta, con tenant_id tomado del contexto (insert() de Eloquent
     * no dispara eventos, así que no pasa por la validación de creating).
     *
     * @param  list<array<string, mixed>>  $rows
     */
    public static function insertForTenant(array $rows): void
    {
        if ($rows === []) {
            return;
        }
        $tenantId = app(TenantContext::class)->id() ?? throw new MissingTenantContext('Alta masiva sin comercio en contexto');
        foreach ($rows as &$row) {
            if (isset($row['tenant_id']) && $row['tenant_id'] !== $tenantId) {
                throw new LogicException('Se intentó crear una fila de otro comercio');
            }
            $row['tenant_id'] = $tenantId;
        }
        static::query()->insert($rows);
    }
}
