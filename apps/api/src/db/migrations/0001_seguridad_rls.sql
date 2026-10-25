-- Seguridad de la base (sección 5 del diseño).
--
-- Roles de grupo, sin login. La API se conecta como gc_app (NOINHERIT) y en cada
-- transacción hace SET LOCAL ROLE a uno de ellos:
--   gc_tenant   operaciones de un comercio; todo filtrado por RLS con app.tenant_id
--   gc_auth     identidad global: usuarios, sesiones y recuperación de contraseña
--   gc_platform panel de plataforma: planes, estado de comercios, métricas agregadas
-- Ninguno es dueño de las tablas ni tiene BYPASSRLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gc_tenant') THEN CREATE ROLE gc_tenant NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gc_auth') THEN CREATE ROLE gc_auth NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gc_platform') THEN CREATE ROLE gc_platform NOLOGIN; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gc_app') THEN
    GRANT gc_tenant, gc_auth, gc_platform TO gc_app;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO gc_tenant, gc_auth, gc_platform;

-- Contexto de la transacción. current_setting(..., true) devuelve NULL si no se definió.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ------------------------------------------------------------ Catálogos globales
GRANT SELECT ON permissions, business_types, plans, plan_limits, plan_features TO gc_tenant, gc_auth, gc_platform;
GRANT INSERT, UPDATE ON plans TO gc_platform;
GRANT INSERT, UPDATE, DELETE ON plan_limits, plan_features TO gc_platform;

-- ------------------------------------------------------------ Plataforma
GRANT SELECT, INSERT, UPDATE ON platform_users, platform_sessions TO gc_platform;

-- ------------------------------------------------------------ Identidad
GRANT SELECT, INSERT, UPDATE ON users, sessions, password_reset_tokens TO gc_auth;
GRANT SELECT (id, name, email, status, created_at) ON users TO gc_tenant;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_auth_all ON users TO gc_auth USING (true) WITH CHECK (true);
-- Un comercio solo ve a sus propios miembros (y cada usuario se ve a sí mismo).
CREATE POLICY users_tenant_members ON users FOR SELECT TO gc_tenant USING (
  id = app_current_user()
  OR id IN (SELECT m.user_id FROM memberships m WHERE m.tenant_id = app_current_tenant())
);

-- ------------------------------------------------------------ Comercios
GRANT SELECT, INSERT ON tenants TO gc_tenant;
GRANT UPDATE (trade_name, legal_name, cuit, tax_condition, address, phone, email, settings, version, updated_at) ON tenants TO gc_tenant;
GRANT SELECT ON tenants TO gc_platform;
GRANT UPDATE (status, updated_at) ON tenants TO gc_platform;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_own ON tenants TO gc_tenant
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
-- Para listar los comercios a los que pertenece el usuario (selector de comercio).
CREATE POLICY tenants_my_memberships ON tenants FOR SELECT TO gc_tenant USING (
  id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = app_current_user())
);
CREATE POLICY tenants_platform_read ON tenants FOR SELECT TO gc_platform USING (true);
CREATE POLICY tenants_platform_status ON tenants FOR UPDATE TO gc_platform USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON subscriptions TO gc_tenant;
GRANT SELECT, UPDATE ON subscriptions TO gc_platform;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant ON subscriptions TO gc_tenant
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY subscriptions_platform ON subscriptions TO gc_platform USING (true) WITH CHECK (true);

-- ------------------------------------------------------------ Tablas por comercio
GRANT SELECT, INSERT, UPDATE ON branches, warehouses, memberships TO gc_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON roles, role_permissions, membership_branches TO gc_tenant;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches', 'warehouses', 'roles', 'role_permissions', 'memberships', 'membership_branches'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I TO gc_tenant USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- Lecturas propias fuera del comercio activo (login y selector de comercio).
CREATE POLICY memberships_own ON memberships FOR SELECT TO gc_tenant USING (user_id = app_current_user());
CREATE POLICY roles_own ON roles FOR SELECT TO gc_tenant USING (
  id IN (SELECT m.role_id FROM memberships m WHERE m.user_id = app_current_user())
);

-- Métricas agregadas para la plataforma, sin exponer filas de los comercios.
CREATE OR REPLACE FUNCTION platform_tenant_usage()
  RETURNS TABLE (tenant_id uuid, user_count bigint, branch_count bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT t.id,
           (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active'),
           (SELECT count(*) FROM branches b WHERE b.tenant_id = t.id AND b.status = 'active')
    FROM tenants t
  $$;
REVOKE EXECUTE ON FUNCTION platform_tenant_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tenant_usage() TO gc_platform;

-- ------------------------------------------------------------ Auditoría (append-only)
GRANT SELECT, INSERT ON audit_log TO gc_tenant, gc_platform;
GRANT INSERT ON audit_log TO gc_auth;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant_read ON audit_log FOR SELECT TO gc_tenant USING (tenant_id = app_current_tenant());
CREATE POLICY audit_tenant_write ON audit_log FOR INSERT TO gc_tenant WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY audit_auth_write ON audit_log FOR INSERT TO gc_auth WITH CHECK (actor_type IN ('user', 'system'));
CREATE POLICY audit_platform_write ON audit_log FOR INSERT TO gc_platform WITH CHECK (actor_type = 'platform');
CREATE POLICY audit_platform_read ON audit_log FOR SELECT TO gc_platform USING (actor_type = 'platform' OR tenant_id IS NULL);

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo agregado: no se permite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
