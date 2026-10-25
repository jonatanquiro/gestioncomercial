// Exporta los catálogos de @gc/contracts (fuente única) a JSON para el servidor PHP.
// Uso: pnpm --filter @gc/contracts build && pnpm --filter @gc/contracts export-catalog
// El CI vuelve a generarlo y falla si el archivo commiteado quedó desactualizado.
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const c = require('../dist/index.js');

const catalog = {
  permissions: Object.entries(c.PERMISSIONS).map(([code, p]) => ({ code, module: p.module, label: p.label })),
  roleTemplates: c.ROLE_TEMPLATES.map((r) => ({ code: r.code, name: r.name, permissions: [...r.permissions] })),
  businessTypes: c.BUSINESS_TYPES,
  taxConditions: [...c.TAX_CONDITIONS],
  planLimitKeys: [...c.PLAN_LIMIT_KEYS],
  planFeatures: [...c.PLAN_FEATURES],
};

const target = resolve(__dirname, '../../../apps/server/database/catalog.json');
writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Catálogo exportado a ${target}`);
