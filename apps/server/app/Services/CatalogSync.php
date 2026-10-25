<?php

namespace App\Services;

use App\Models\Plan;
use App\Models\PlanFeature;
use App\Models\PlanLimit;
use App\Support\Catalog;
use Illuminate\Support\Facades\DB;

/**
 * Sincroniza catálogos que viven en el código (permisos, rubros) y crea los planes iniciales
 * si no existen. Es idempotente y corre después de cada `php artisan migrate`. Los planes
 * existentes no se pisan: se editan desde el panel de plataforma.
 */
class CatalogSync
{
    /** Planes iniciales (sección 18 del diseño). El precio se configura desde el panel. */
    private const PLAN_SEEDS = [
        ['code' => 'inicial', 'name' => 'Inicial', 'sort' => 1,
            'limits' => ['max_branches' => 1, 'max_users' => 3, 'max_products' => 2000, 'max_registers' => 1],
            'features' => ['fiscal_arca']],
        ['code' => 'profesional', 'name' => 'Profesional', 'sort' => 2,
            'limits' => ['max_branches' => 1, 'max_users' => 10, 'max_products' => 20000, 'max_registers' => 3],
            'features' => ['fiscal_arca', 'advanced_reports', 'promotions']],
        ['code' => 'multisucursal', 'name' => 'Multi-sucursal', 'sort' => 3,
            'limits' => ['max_branches' => 5, 'max_users' => 30, 'max_products' => 50000, 'max_registers' => 15],
            'features' => ['fiscal_arca', 'advanced_reports', 'promotions', 'multi_branch', 'offline_pos', 'variants']],
        ['code' => 'avanzado', 'name' => 'Avanzado', 'sort' => 4,
            'limits' => ['max_branches' => 20, 'max_users' => 100, 'max_products' => 200000, 'max_registers' => 60],
            'features' => ['fiscal_arca', 'advanced_reports', 'promotions', 'multi_branch', 'offline_pos', 'variants']],
    ];

    public function run(): void
    {
        DB::transaction(function () {
            DB::table('permissions')->upsert(
                array_map(fn ($p) => ['code' => $p['code'], 'module' => $p['module'], 'label' => $p['label']], Catalog::all()['permissions']),
                ['code'],
                ['module', 'label'],
            );
            $types = [];
            foreach (Catalog::businessTypes() as $i => $bt) {
                $types[] = [
                    'code' => $bt['code'],
                    'name' => $bt['name'],
                    'default_settings' => json_encode($bt['defaultSettings'], JSON_UNESCAPED_UNICODE),
                    'default_categories' => json_encode($bt['defaultCategories'], JSON_UNESCAPED_UNICODE),
                    'recommended_features' => json_encode($bt['recommendedFeatures'], JSON_UNESCAPED_UNICODE),
                    'sort_order' => $i,
                ];
            }
            DB::table('business_types')->upsert($types, ['code'], ['name', 'default_settings', 'default_categories', 'recommended_features', 'sort_order']);

            foreach (self::PLAN_SEEDS as $seed) {
                if (Plan::where('code', $seed['code'])->exists()) {
                    continue;
                }
                $plan = Plan::create(['code' => $seed['code'], 'name' => $seed['name'], 'price' => '0', 'sort_order' => $seed['sort']]);
                PlanLimit::insert(array_map(fn ($k, $v) => ['plan_id' => $plan->id, 'key' => $k, 'value' => $v], array_keys($seed['limits']), $seed['limits']));
                PlanFeature::insert(array_map(fn ($f) => ['plan_id' => $plan->id, 'feature' => $f], $seed['features']));
            }
        });
    }
}
