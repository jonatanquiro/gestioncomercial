/**
 * Catálogo fijo de permisos. Es la única fuente de verdad: la API lo siembra en la
 * base y la web lo usa para mostrar etiquetas. Agregar un permiso = agregarlo acá
 * y crear una migración que lo inserte.
 */
export const PERMISSIONS = {
  // Productos
  'products.read': { module: 'Productos', label: 'Consultar productos' },
  'products.create': { module: 'Productos', label: 'Crear productos' },
  'products.update': { module: 'Productos', label: 'Modificar productos' },
  'products.deactivate': { module: 'Productos', label: 'Desactivar productos' },
  'products.import': { module: 'Productos', label: 'Importar productos' },
  'products.export': { module: 'Productos', label: 'Exportar productos' },
  // Costos y precios
  'costs.read': { module: 'Costos y precios', label: 'Consultar costos' },
  'costs.update': { module: 'Costos y precios', label: 'Modificar costos' },
  'prices.update': { module: 'Costos y precios', label: 'Modificar precios' },
  'prices.bulk_update': { module: 'Costos y precios', label: 'Modificar precios masivamente' },
  'promotions.manage': { module: 'Costos y precios', label: 'Administrar promociones' },
  // Inventario
  'stock.read': { module: 'Inventario', label: 'Consultar stock' },
  'stock.adjust': { module: 'Inventario', label: 'Ajustar stock' },
  'stock.count': { module: 'Inventario', label: 'Realizar inventarios físicos' },
  'stock.transfer': { module: 'Inventario', label: 'Transferir entre sucursales' },
  'stock.waste': { module: 'Inventario', label: 'Registrar mermas y vencidos' },
  // Ventas
  'sales.create': { module: 'Ventas', label: 'Realizar ventas' },
  'sales.discount': { module: 'Ventas', label: 'Aplicar descuentos hasta el límite' },
  'sales.discount_unlimited': { module: 'Ventas', label: 'Aplicar descuentos sin límite' },
  'sales.read_own': { module: 'Ventas', label: 'Consultar ventas propias' },
  'sales.read_all': { module: 'Ventas', label: 'Consultar todas las ventas' },
  'sales.void': { module: 'Ventas', label: 'Anular ventas' },
  'sales.return': { module: 'Ventas', label: 'Autorizar devoluciones' },
  'sales.offline': { module: 'Ventas', label: 'Vender sin conexión' },
  'fiscal.issue': { module: 'Ventas', label: 'Emitir facturas electrónicas' },
  // Caja
  'cash.open': { module: 'Caja', label: 'Abrir caja' },
  'cash.close': { module: 'Caja', label: 'Cerrar caja' },
  'cash.withdraw': { module: 'Caja', label: 'Retirar efectivo' },
  'cash.deposit': { module: 'Caja', label: 'Ingresar efectivo' },
  'cash.count': { module: 'Caja', label: 'Realizar arqueos' },
  'cash.correct_closed': { module: 'Caja', label: 'Corregir cierres de caja' },
  'cash.read_all': { module: 'Caja', label: 'Consultar todas las cajas' },
  // Compras
  'suppliers.manage': { module: 'Compras', label: 'Administrar proveedores' },
  'purchases.create': { module: 'Compras', label: 'Registrar compras' },
  'purchases.receive': { module: 'Compras', label: 'Recibir mercadería' },
  'purchases.pay': { module: 'Compras', label: 'Pagar a proveedores' },
  // Clientes
  'customers.manage': { module: 'Clientes', label: 'Administrar clientes' },
  'accounts.grant_credit': { module: 'Clientes', label: 'Otorgar crédito en cuenta corriente' },
  'accounts.collect': { module: 'Clientes', label: 'Registrar cobros' },
  // Gastos
  'expenses.create': { module: 'Gastos', label: 'Registrar gastos' },
  'expenses.read': { module: 'Gastos', label: 'Consultar gastos' },
  // Reportes
  'reports.sales': { module: 'Reportes', label: 'Consultar reportes de ventas' },
  'reports.profit': { module: 'Reportes', label: 'Consultar ganancias y márgenes' },
  'reports.cash': { module: 'Reportes', label: 'Consultar reportes de caja' },
  'reports.export': { module: 'Reportes', label: 'Exportar reportes' },
  // Administración
  'users.manage': { module: 'Administración', label: 'Administrar empleados' },
  'roles.manage': { module: 'Administración', label: 'Administrar roles y permisos' },
  'settings.manage': { module: 'Administración', label: 'Configurar el comercio' },
  'branches.manage': { module: 'Administración', label: 'Administrar sucursales' },
  'fiscal.manage': { module: 'Administración', label: 'Administrar datos fiscales' },
  'subscription.manage': { module: 'Administración', label: 'Gestionar la suscripción' },
  'audit.read': { module: 'Administración', label: 'Consultar auditoría' },
  'support.grant': { module: 'Administración', label: 'Autorizar acceso de soporte' },
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: string): value is PermissionCode {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
