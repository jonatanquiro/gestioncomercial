-- Borra TODOS los comercios, sus usuarios y sus operaciones. Conserva los operadores del panel de
-- plataforma, los catálogos globales (rubros, planes, permisos, productos de referencia) y las migraciones.
-- No se puede deshacer: respaldar la base antes. Se usa TRUNCATE porque la auditoría, la caja y el stock
-- tienen disparadores que impiden borrar filas con DELETE.

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE audit_log;
TRUNCATE TABLE barcodes;
TRUNCATE TABLE branches;
TRUNCATE TABLE brands;
TRUNCATE TABLE cash_counts;
TRUNCATE TABLE cash_movements;
TRUNCATE TABLE cash_shifts;
TRUNCATE TABLE categories;
TRUNCATE TABLE document_sequences;
TRUNCATE TABLE fiscal_invoices;
TRUNCATE TABLE fiscal_settings;
TRUNCATE TABLE memberships;
TRUNCATE TABLE membership_branches;
TRUNCATE TABLE payment_methods;
TRUNCATE TABLE price_change_batches;
TRUNCATE TABLE products;
TRUNCATE TABLE product_variants;
TRUNCATE TABLE registers;
TRUNCATE TABLE roles;
TRUNCATE TABLE role_permissions;
TRUNCATE TABLE sales;
TRUNCATE TABLE sale_lines;
TRUNCATE TABLE sale_payments;
TRUNCATE TABLE sale_returns;
TRUNCATE TABLE sale_return_lines;
TRUNCATE TABLE settlements;
TRUNCATE TABLE settlement_items;
TRUNCATE TABLE stock_counts;
TRUNCATE TABLE stock_count_lines;
TRUNCATE TABLE stock_levels;
TRUNCATE TABLE stock_movements;
TRUNCATE TABLE subscriptions;
TRUNCATE TABLE user_sessions;
TRUNCATE TABLE variant_costs;
TRUNCATE TABLE variant_prices;
TRUNCATE TABLE warehouses;
TRUNCATE TABLE tenants;
TRUNCATE TABLE password_reset_tokens;
TRUNCATE TABLE users;
-- Límites de intentos y otros datos temporales.
TRUNCATE TABLE cache;
TRUNCATE TABLE cache_locks;

SET FOREIGN_KEY_CHECKS = 1;
