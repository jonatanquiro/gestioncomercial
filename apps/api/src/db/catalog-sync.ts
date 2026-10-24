import { BUSINESS_TYPES, PERMISSIONS } from '@gc/contracts';
import type { PoolClient } from 'pg';

interface PlanSeed {
  code: string;
  name: string;
  sortOrder: number;
  limits: Record<string, number>;
  features: string[];
}

/** Planes iniciales (sección 18). El precio se configura desde el panel de plataforma. */
const PLAN_SEEDS: PlanSeed[] = [
  { code: 'inicial', name: 'Inicial', sortOrder: 1, limits: { max_branches: 1, max_users: 3, max_products: 2000, max_registers: 1 }, features: ['fiscal_arca'] },
  { code: 'profesional', name: 'Profesional', sortOrder: 2, limits: { max_branches: 1, max_users: 10, max_products: 20000, max_registers: 3 }, features: ['fiscal_arca', 'advanced_reports', 'promotions'] },
  { code: 'multisucursal', name: 'Multi-sucursal', sortOrder: 3, limits: { max_branches: 5, max_users: 30, max_products: 50000, max_registers: 15 }, features: ['fiscal_arca', 'advanced_reports', 'promotions', 'multi_branch', 'offline_pos', 'variants'] },
  { code: 'avanzado', name: 'Avanzado', sortOrder: 4, limits: { max_branches: 20, max_users: 100, max_products: 200000, max_registers: 60 }, features: ['fiscal_arca', 'advanced_reports', 'promotions', 'multi_branch', 'offline_pos', 'variants'] },
];

/**
 * Sincroniza catálogos que viven en el código (permisos, rubros) y crea los planes
 * iniciales si no existen. Es idempotente; corre como dueño después de migrar.
 * Los planes existentes no se pisan: se editan desde el panel de plataforma.
 */
export async function syncCatalogs(client: PoolClient): Promise<void> {
  for (const [code, p] of Object.entries(PERMISSIONS)) {
    await client.query(
      `INSERT INTO permissions (code, module, label) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET module = excluded.module, label = excluded.label`,
      [code, p.module, p.label],
    );
  }
  for (const [i, bt] of BUSINESS_TYPES.entries()) {
    await client.query(
      `INSERT INTO business_types (code, name, default_settings, default_categories, recommended_features, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET name = excluded.name, default_settings = excluded.default_settings,
         default_categories = excluded.default_categories, recommended_features = excluded.recommended_features,
         sort_order = excluded.sort_order`,
      [bt.code, bt.name, JSON.stringify(bt.defaultSettings), JSON.stringify(bt.defaultCategories), JSON.stringify(bt.recommendedFeatures), i],
    );
  }
  for (const plan of PLAN_SEEDS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO plans (id, code, name, price, sort_order) VALUES (gen_random_uuid(), $1, $2, 0, $3)
       ON CONFLICT (code) DO NOTHING RETURNING id`,
      [plan.code, plan.name, plan.sortOrder],
    );
    const created = rows[0];
    if (!created) continue;
    for (const [key, value] of Object.entries(plan.limits)) {
      await client.query('INSERT INTO plan_limits (plan_id, key, value) VALUES ($1, $2, $3)', [created.id, key, value]);
    }
    for (const feature of plan.features) {
      await client.query('INSERT INTO plan_features (plan_id, feature) VALUES ($1, $2)', [created.id, feature]);
    }
  }
}
