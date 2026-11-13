<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Ingreso de mercadería (ADR 0014): proveedores y compras recibidas. Cada línea suma stock con
 * un movimiento «purchase_in» y, si se pide, actualiza el costo vigente de la variante. Una compra
 * no se edita: un error se corrige con un ajuste de stock.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('suppliers', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('name', 120);
            $t->string('cuit', 11)->nullable();
            $t->string('phone', 30)->nullable();
            $t->string('email', 254)->nullable();
            $t->string('notes', 300)->nullable();
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'suppliers_tenant_id_uq');
            $t->unique(['tenant_id', 'name'], 'suppliers_tenant_name_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
        });

        Schema::create('purchases', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('client_uuid');
            $t->unsignedBigInteger('number');
            $t->uuid('branch_id');
            $t->uuid('warehouse_id');
            $t->uuid('supplier_id')->nullable();
            $t->string('document', 60)->nullable();
            $t->string('notes', 300)->nullable();
            // Suma de cantidad × costo; null si alguna línea no trae costo.
            $t->decimal('total_cost', 16, 4)->nullable();
            $t->boolean('updated_costs');
            $t->uuid('created_by');
            $t->dateTime('created_at', 6);
            $t->unique(['tenant_id', 'id'], 'purchases_tenant_id_uq');
            $t->unique(['tenant_id', 'client_uuid'], 'purchases_client_uuid_uq');
            $t->unique(['tenant_id', 'branch_id', 'number'], 'purchases_branch_number_uq');
            $t->index(['tenant_id', 'created_at'], 'purchases_created_idx');
            $t->foreign(['tenant_id', 'branch_id'], 'purchases_branch_fk')->references(['tenant_id', 'id'])->on('branches');
            $t->foreign(['tenant_id', 'warehouse_id'], 'purchases_warehouse_fk')->references(['tenant_id', 'id'])->on('warehouses');
            $t->foreign(['tenant_id', 'supplier_id'], 'purchases_supplier_fk')->references(['tenant_id', 'id'])->on('suppliers');
            $t->foreign('created_by')->references('id')->on('users');
        });

        Schema::create('purchase_lines', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('purchase_id');
            $t->unsignedSmallInteger('line_no');
            $t->uuid('variant_id');
            $t->string('description', 160);
            $t->decimal('quantity', 14, 3);
            $t->decimal('unit_cost', 14, 4)->nullable();
            $t->unique(['tenant_id', 'id'], 'purchase_lines_tenant_id_uq');
            $t->unique(['purchase_id', 'line_no'], 'purchase_lines_line_uq');
            $t->foreign(['tenant_id', 'purchase_id'], 'purchase_lines_purchase_fk')->references(['tenant_id', 'id'])->on('purchases');
            $t->foreign(['tenant_id', 'variant_id'], 'purchase_lines_variant_fk')->references(['tenant_id', 'id'])->on('product_variants');
        });

        DB::statement("ALTER TABLE suppliers ADD CONSTRAINT suppliers_status_ck CHECK (status IN ('active', 'inactive'))");
        DB::statement('ALTER TABLE purchase_lines ADD CONSTRAINT purchase_lines_values_ck CHECK (quantity > 0 AND (unit_cost IS NULL OR unit_cost >= 0))');
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_lines');
        Schema::dropIfExists('purchases');
        Schema::dropIfExists('suppliers');
    }
};
