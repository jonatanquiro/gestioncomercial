import { PERMISSION_CODES, type PermissionCode } from './permissions';

export type RoleTemplateCode =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'stocker'
  | 'seller'
  | 'purchasing'
  | 'accountant';

export interface RoleTemplate {
  code: RoleTemplateCode;
  name: string;
  permissions: readonly PermissionCode[];
}

const all = PERMISSION_CODES;
const without = (...excluded: PermissionCode[]) => all.filter((p) => !excluded.includes(p));

/** Roles plantilla que se copian a cada comercio nuevo (sección 6 del diseño). */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  { code: 'owner', name: 'Propietario', permissions: all },
  { code: 'admin', name: 'Administrador', permissions: without('subscription.manage') },
  {
    code: 'manager',
    name: 'Encargado',
    permissions: [
      'products.read', 'products.create', 'products.update', 'products.deactivate', 'products.export',
      'prices.update', 'stock.read', 'stock.adjust', 'stock.count', 'stock.transfer', 'stock.waste',
      'sales.create', 'sales.discount', 'sales.read_all', 'sales.void', 'sales.return', 'sales.offline', 'fiscal.issue',
      'cash.open', 'cash.close', 'cash.withdraw', 'cash.deposit', 'cash.count', 'cash.read_all',
      'purchases.create', 'purchases.receive', 'suppliers.manage', 'customers.manage', 'accounts.collect',
      'expenses.create', 'expenses.read', 'reports.sales', 'reports.cash',
    ],
  },
  {
    code: 'cashier',
    name: 'Cajero',
    permissions: [
      'products.read', 'stock.read', 'sales.create', 'sales.discount', 'sales.read_own', 'sales.offline', 'fiscal.issue',
      'cash.open', 'cash.close', 'cash.count', 'customers.manage', 'accounts.collect',
    ],
  },
  {
    code: 'stocker',
    name: 'Repositor',
    permissions: [
      'products.read', 'products.create', 'products.update', 'stock.read', 'stock.adjust', 'stock.count',
      'stock.waste', 'purchases.receive',
    ],
  },
  {
    code: 'seller',
    name: 'Vendedor',
    permissions: ['products.read', 'stock.read', 'sales.create', 'sales.discount', 'sales.read_own', 'customers.manage'],
  },
  {
    code: 'purchasing',
    name: 'Responsable de compras',
    permissions: [
      'products.read', 'products.create', 'products.update', 'costs.read', 'costs.update', 'stock.read',
      'suppliers.manage', 'purchases.create', 'purchases.receive', 'purchases.pay', 'expenses.create',
      'expenses.read',
    ],
  },
  {
    code: 'accountant',
    name: 'Contador',
    permissions: [
      'products.read', 'costs.read', 'stock.read', 'sales.read_all', 'cash.read_all', 'expenses.read',
      'reports.sales', 'reports.profit', 'reports.cash', 'reports.export', 'audit.read',
    ],
  },
];
