<?php

use App\Support\Triggers;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Núcleo multiempresa (sección 4 y 0 del diseño), compatible con MySQL 8 y MariaDB 10.4+ (XAMPP).
 *
 * - PK UUID v7 (CHAR(36)) generada por la aplicación.
 * - Toda tabla comercial tiene tenant_id y UNIQUE (tenant_id, id); los hijos referencian
 *   (tenant_id, padre_id), así la base rechaza que una fila apunte a datos de otro comercio.
 * - MySQL no tiene índices únicos parciales: se usa una columna generada que vale 1 cuando la
 *   fila participa de la restricción y NULL cuando no (los NULL no chocan en un UNIQUE). La
 *   columna depende solo de campos VARCHAR o booleanos porque MariaDB no admite columnas
 *   generadas que dependan de CHAR.
 * - La colación utf8mb4_unicode_ci hace que emails y nombres únicos no distingan mayúsculas.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------ Catálogos globales
        Schema::create('permissions', function (Blueprint $t) {
            $t->string('code', 60)->primary();
            $t->string('module', 60);
            $t->string('label', 120);
        });

        Schema::create('business_types', function (Blueprint $t) {
            $t->string('code', 40)->primary();
            $t->string('name', 80);
            $t->json('default_settings');
            $t->json('default_categories');
            $t->json('recommended_features');
            $t->unsignedInteger('sort_order')->default(0);
        });

        Schema::create('plans', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('code', 40)->unique();
            $t->string('name', 60);
            $t->decimal('price', 12, 2);
            $t->char('currency', 3)->default('ARS');
            $t->unsignedInteger('trial_days')->default(14);
            $t->boolean('active')->default(true);
            $t->unsignedInteger('sort_order')->default(0);
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });

        Schema::create('plan_limits', function (Blueprint $t) {
            $t->uuid('plan_id');
            $t->string('key', 40);
            $t->unsignedInteger('value');
            $t->primary(['plan_id', 'key']);
            $t->foreign('plan_id')->references('id')->on('plans')->cascadeOnDelete();
        });

        Schema::create('plan_features', function (Blueprint $t) {
            $t->uuid('plan_id');
            $t->string('feature', 40);
            $t->primary(['plan_id', 'feature']);
            $t->foreign('plan_id')->references('id')->on('plans')->cascadeOnDelete();
        });

        // ------------------------------------------------------------ Plataforma
        Schema::create('platform_users', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('email', 254)->unique();
            $t->string('name', 120);
            $t->string('password_hash', 255);
            $t->text('totp_secret_enc');
            $t->string('role', 20)->default('admin');
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
        });

        Schema::create('platform_sessions', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('platform_user_id');
            $t->char('token_hash', 64)->unique();
            $t->string('ip', 45)->nullable();
            $t->string('user_agent', 300)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('last_seen_at', 6);
            $t->dateTime('expires_at', 6);
            $t->dateTime('revoked_at', 6)->nullable();
            $t->foreign('platform_user_id')->references('id')->on('platform_users');
        });

        // ------------------------------------------------------------ Identidad (global)
        Schema::create('users', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('email', 254)->unique('users_email_uq');
            $t->string('name', 120);
            $t->string('password_hash', 255);
            $t->string('status', 20)->default('active');
            $t->dateTime('password_changed_at', 6);
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });

        Schema::create('user_sessions', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('user_id')->index();
            $t->uuid('tenant_id')->nullable();
            $t->char('token_hash', 64)->unique();
            $t->string('ip', 45)->nullable();
            $t->string('user_agent', 300)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('last_seen_at', 6);
            $t->dateTime('expires_at', 6);
            $t->dateTime('revoked_at', 6)->nullable();
            $t->foreign('user_id')->references('id')->on('users');
        });

        Schema::create('password_reset_tokens', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('user_id');
            $t->char('token_hash', 64)->unique();
            $t->dateTime('expires_at', 6);
            $t->dateTime('used_at', 6)->nullable();
            $t->dateTime('created_at', 6);
            $t->foreign('user_id')->references('id')->on('users');
        });

        // ------------------------------------------------------------ Comercio
        Schema::create('tenants', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('trade_name', 120);
            $t->string('legal_name', 160)->nullable();
            $t->char('cuit', 11)->nullable();
            $t->string('tax_condition', 30);
            $t->string('business_type_code', 40);
            $t->string('status', 20)->default('trial');
            $t->string('address', 200)->nullable();
            $t->string('phone', 40)->nullable();
            $t->string('email', 254)->nullable();
            $t->json('settings');
            $t->unsignedInteger('version')->default(1);
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            // Un CUIT no puede estar en dos comercios que no estén dados de baja.
            $t->boolean('not_cancelled')->nullable()->storedAs("IF(status <> 'cancelled', 1, NULL)");
            $t->unique(['cuit', 'not_cancelled'], 'tenants_cuit_active_uq');
            $t->foreign('business_type_code')->references('code')->on('business_types');
        });

        Schema::create('subscriptions', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('plan_id');
            $t->string('status', 20);
            $t->dateTime('trial_ends_at', 6)->nullable();
            $t->dateTime('current_period_end', 6)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            // Una sola suscripción vigente por comercio.
            $t->boolean('is_current')->nullable()->storedAs("IF(status <> 'cancelled', 1, NULL)");
            $t->unique(['tenant_id', 'is_current'], 'subscriptions_one_current_uq');
            $t->unique(['tenant_id', 'id'], 'subscriptions_tenant_id_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
            $t->foreign('plan_id')->references('id')->on('plans');
        });

        Schema::create('branches', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('name', 80);
            $t->string('address', 200)->nullable();
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'branches_tenant_id_uq');
            $t->unique(['tenant_id', 'name'], 'branches_tenant_name_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
        });

        Schema::create('warehouses', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('branch_id');
            $t->string('name', 80);
            $t->boolean('is_default')->default(false);
            $t->dateTime('created_at', 6);
            // Un solo depósito por defecto por sucursal.
            $t->boolean('default_flag')->nullable()->storedAs('IF(is_default, 1, NULL)');
            $t->unique(['branch_id', 'default_flag'], 'warehouses_one_default_uq');
            $t->unique(['tenant_id', 'id'], 'warehouses_tenant_id_uq');
            $t->foreign(['tenant_id', 'branch_id'], 'warehouses_branch_fk')->references(['tenant_id', 'id'])->on('branches');
        });

        Schema::create('roles', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('name', 60);
            $t->boolean('is_system')->default(false);
            $t->string('template_code', 30)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'roles_tenant_id_uq');
            $t->unique(['tenant_id', 'name'], 'roles_tenant_name_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
        });

        Schema::create('role_permissions', function (Blueprint $t) {
            $t->uuid('tenant_id');
            $t->uuid('role_id');
            $t->string('permission_code', 60);
            $t->primary(['role_id', 'permission_code']);
            $t->foreign(['tenant_id', 'role_id'], 'role_permissions_role_fk')->references(['tenant_id', 'id'])->on('roles')->cascadeOnDelete();
            $t->foreign('permission_code')->references('code')->on('permissions');
        });

        Schema::create('memberships', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('user_id')->index();
            $t->uuid('role_id');
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'memberships_tenant_id_uq');
            $t->unique(['tenant_id', 'user_id'], 'memberships_tenant_user_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
            $t->foreign('user_id')->references('id')->on('users');
            $t->foreign(['tenant_id', 'role_id'], 'memberships_role_fk')->references(['tenant_id', 'id'])->on('roles');
        });

        Schema::create('membership_branches', function (Blueprint $t) {
            $t->uuid('tenant_id');
            $t->uuid('membership_id');
            $t->uuid('branch_id');
            $t->primary(['membership_id', 'branch_id']);
            $t->foreign(['tenant_id', 'membership_id'], 'membership_branches_membership_fk')->references(['tenant_id', 'id'])->on('memberships')->cascadeOnDelete();
            $t->foreign(['tenant_id', 'branch_id'], 'membership_branches_branch_fk')->references(['tenant_id', 'id'])->on('branches');
        });

        // ------------------------------------------------------------ Auditoría (solo agregado)
        Schema::create('audit_log', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id')->nullable();
            $t->string('actor_type', 20);
            $t->uuid('actor_id')->nullable();
            $t->string('actor_name', 160)->nullable();
            $t->string('action', 60);
            $t->string('entity_type', 40);
            $t->uuid('entity_id')->nullable();
            $t->json('before')->nullable();
            $t->json('after')->nullable();
            $t->string('ip', 45)->nullable();
            $t->string('request_id', 64)->nullable();
            $t->dateTime('at', 6);
            $t->index(['tenant_id', 'at'], 'audit_tenant_at_idx');
            $t->index(['tenant_id', 'entity_type', 'entity_id', 'at'], 'audit_tenant_entity_idx');
        });

        $checks = [
            'users' => ['users_status_ck', "status IN ('active', 'disabled')"],
            'tenants' => ['tenants_status_ck', "status IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')"],
            'subscriptions' => ['subscriptions_status_ck', "status IN ('trialing', 'active', 'past_due', 'cancelled')"],
            'branches' => ['branches_status_ck', "status IN ('active', 'inactive')"],
            'memberships' => ['memberships_status_ck', "status IN ('active', 'inactive')"],
            'audit_log' => ['audit_actor_type_ck', "actor_type IN ('user', 'platform', 'system')"],
        ];
        foreach ($checks as $table => [$name, $expr]) {
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$name} CHECK ({$expr})");
        }
        DB::statement("ALTER TABLE tenants ADD CONSTRAINT tenants_tax_condition_ck CHECK (tax_condition IN ('responsable_inscripto', 'monotributo', 'exento'))");

        // La auditoría no se puede modificar ni borrar, tampoco desde la consola de la base.
        Triggers::create("CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log es de solo agregado: no se permite UPDATE'");
        Triggers::create("CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log es de solo agregado: no se permite DELETE'");
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS audit_log_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS audit_log_no_delete');
        foreach ([
            'audit_log', 'membership_branches', 'memberships', 'role_permissions', 'roles', 'warehouses', 'branches',
            'subscriptions', 'tenants', 'password_reset_tokens', 'user_sessions', 'users', 'platform_sessions',
            'platform_users', 'plan_features', 'plan_limits', 'plans', 'business_types', 'permissions',
        ] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
