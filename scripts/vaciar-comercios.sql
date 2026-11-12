-- Borra TODOS los comercios, sus usuarios y sus operaciones. Conserva los operadores del panel de
-- plataforma, los catálogos globales (rubros, planes, permisos, productos de referencia) y las migraciones.
-- No se puede deshacer: respaldar la base antes. Se usa TRUNCATE porque la auditoría, la caja, el stock y
-- las cuentas corrientes tienen disparadores que impiden borrar filas con DELETE.
-- Correrlo con la base al día (después de «Actualizar base de datos»): si falta alguna tabla, se corta.
-- Si se agrega una tabla con tenant_id, sumarla acá.

SET FOREIGN_KEY_CHECKS = 0;

-- Datos de cada comercio (toda tabla con tenant_id).
TRUNCATE TABLE audit_log;
TRUNCATE TABLE barcodes;
TRUNCATE TABLE branches;
TRUNCATE TABLE brands;
TRUNCATE TABLE cash_counts;
TRUNCATE TABLE cash_movements;
TRUNCATE TABLE cash_shifts;
TRUNCATE TABLE categories;
TRUNCATE TABLE customers;
TRUNCATE TABLE customer_movements;
TRUNCATE TABLE document_sequences;
TRUNCATE TABLE fiscal_invoices;
TRUNCATE TABLE fiscal_settings;
TRUNCATE TABLE gift_cards;
TRUNCATE TABLE gift_card_movements;
TRUNCATE TABLE memberships;
TRUNCATE TABLE membership_branches;
TRUNCATE TABLE payment_methods;
TRUNCATE TABLE price_change_batches;
TRUNCATE TABLE products;
TRUNCATE TABLE product_variants;
TRUNCATE TABLE promotions;
TRUNCATE TABLE promotion_items;
TRUNCATE TABLE purchases;
TRUNCATE TABLE purchase_lines;
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
TRUNCATE TABLE subscription_payments;
TRUNCATE TABLE suppliers;
TRUNCATE TABLE supplier_movements;
TRUNCATE TABLE user_sessions;
TRUNCATE TABLE variant_costs;
TRUNCATE TABLE variant_prices;
TRUNCATE TABLE warehouses;

-- Comercios, personas y sus accesos.
TRUNCATE TABLE tenants;
TRUNCATE TABLE password_reset_tokens;
TRUNCATE TABLE users;

-- Límites de intentos y otros datos temporales.
TRUNCATE TABLE cache;
TRUNCATE TABLE cache_locks;

SET FOREIGN_KEY_CHECKS = 1;
