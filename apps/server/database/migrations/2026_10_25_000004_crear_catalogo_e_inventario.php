<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/*
 * Fase 3: catálogo de productos, precios y costos con historial, e inventario por movimientos
 * (secciones 4 y 8 del diseño). Mismas convenciones que el núcleo: UNIQUE (tenant_id, id),
 * FKs compuestas (tenant_id, x_id) y columnas generadas en lugar de índices únicos parciales.
 *
 * - Todo producto tiene una variante: es lo que se vende, se stockea y tiene precio. En el MVP
 *   hay una sola por producto y la interfaz no la muestra.
 * - El precio y el costo vigentes se guardan en la variante y cada cambio deja una fila en
 *   variant_prices / variant_costs (historial) en la misma transacción.
 * - stock_levels es el saldo materializado; stock_movements, el libro de movimientos. El saldo
 *   solo cambia junto con un movimiento y siempre coincide con la suma de los movimientos.
 * - Los movimientos de stock y el historial de costos son de solo agregado (disparadores).
 */
return new class extends Migration
{
    private const APPEND_ONLY = ['stock_movements', 'variant_costs'];

    public function up(): void
    {
        Schema::create('categories', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('name', 80);
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'categories_tenant_id_uq');
            $t->unique(['tenant_id', 'name'], 'categories_tenant_name_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
        });

        Schema::create('brands', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('name', 80);
            $t->dateTime('created_at', 6);
            $t->unique(['tenant_id', 'id'], 'brands_tenant_id_uq');
            $t->unique(['tenant_id', 'name'], 'brands_tenant_name_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
        });

        Schema::create('products', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('kind', 20)->default('good');
            $t->string('name', 160);
            $t->string('description', 500)->nullable();
            $t->uuid('category_id')->nullable();
            $t->uuid('brand_id')->nullable();
            $t->string('sale_mode', 20)->default('unit');
            $t->string('vat_rate', 20);
            $t->boolean('track_stock')->default(true);
            $t->decimal('min_stock', 14, 3)->nullable();
            $t->boolean('block_negative_stock')->default(false);
            $t->string('status', 20)->default('active');
            $t->unsignedInteger('version')->default(1);
            $t->uuid('created_by')->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'products_tenant_id_uq');
            $t->index(['tenant_id', 'status', 'name'], 'products_tenant_status_name_idx');
            $t->foreign('tenant_id')->references('id')->on('tenants');
            $t->foreign(['tenant_id', 'category_id'], 'products_category_fk')->references(['tenant_id', 'id'])->on('categories');
            $t->foreign(['tenant_id', 'brand_id'], 'products_brand_fk')->references(['tenant_id', 'id'])->on('brands');
        });

        Schema::create('product_variants', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('product_id');
            $t->string('sku', 60)->nullable();
            $t->decimal('price', 14, 2);
            $t->decimal('cost', 14, 4)->nullable();
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'product_variants_tenant_id_uq');
            $t->unique(['tenant_id', 'sku'], 'product_variants_tenant_sku_uq');
            $t->index(['tenant_id', 'product_id'], 'product_variants_product_idx');
            $t->foreign(['tenant_id', 'product_id'], 'product_variants_product_fk')->references(['tenant_id', 'id'])->on('products');
        });

        Schema::create('barcodes', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('variant_id');
            $t->string('code', 64);
            // Cuántas unidades vende el código: 1 para la unidad, 12 para el código del pack.
            $t->decimal('quantity_factor', 14, 3)->default(1);
            $t->dateTime('created_at', 6);
            $t->unique(['tenant_id', 'id'], 'barcodes_tenant_id_uq');
            $t->unique(['tenant_id', 'code'], 'barcodes_tenant_code_uq');
            $t->index(['tenant_id', 'variant_id'], 'barcodes_variant_idx');
            $t->foreign(['tenant_id', 'variant_id'], 'barcodes_variant_fk')->references(['tenant_id', 'id'])->on('product_variants');
        });

        Schema::create('price_change_batches', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->json('scope');
            $t->json('rule');
            $t->unsignedInteger('rounding_step');
            $t->unsignedInteger('affected_count');
            $t->uuid('applied_by');
            $t->dateTime('applied_at', 6);
            $t->unique(['tenant_id', 'id'], 'price_change_batches_tenant_id_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
            $t->foreign('applied_by')->references('id')->on('users');
        });

        Schema::create('variant_prices', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('variant_id');
            $t->decimal('price', 14, 2);
            $t->dateTime('valid_from', 6);
            $t->dateTime('valid_to', 6)->nullable();
            $t->boolean('is_current')->default(true);
            $t->uuid('changed_by')->nullable();
            $t->uuid('batch_id')->nullable();
            // Un solo precio vigente por variante.
            $t->boolean('current_flag')->nullable()->storedAs('IF(is_current, 1, NULL)');
            $t->unique(['variant_id', 'current_flag'], 'variant_prices_one_current_uq');
            $t->unique(['tenant_id', 'id'], 'variant_prices_tenant_id_uq');
            $t->index(['tenant_id', 'variant_id', 'valid_from'], 'variant_prices_variant_idx');
            $t->foreign(['tenant_id', 'variant_id'], 'variant_prices_variant_fk')->references(['tenant_id', 'id'])->on('product_variants');
            $t->foreign(['tenant_id', 'batch_id'], 'variant_prices_batch_fk')->references(['tenant_id', 'id'])->on('price_change_batches');
            $t->foreign('changed_by')->references('id')->on('users');
        });

        Schema::create('variant_costs', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('variant_id');
            $t->decimal('cost', 14, 4);
            $t->string('source', 20);
            $t->uuid('changed_by')->nullable();
            $t->dateTime('at', 6);
            $t->unique(['tenant_id', 'id'], 'variant_costs_tenant_id_uq');
            $t->index(['tenant_id', 'variant_id', 'at'], 'variant_costs_variant_idx');
            $t->foreign(['tenant_id', 'variant_id'], 'variant_costs_variant_fk')->references(['tenant_id', 'id'])->on('product_variants');
            $t->foreign('changed_by')->references('id')->on('users');
        });

        Schema::create('stock_levels', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('warehouse_id');
            $t->uuid('variant_id');
            $t->decimal('on_hand', 14, 3)->default(0);
            $t->unsignedInteger('version')->default(0);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'stock_levels_tenant_id_uq');
            $t->unique(['tenant_id', 'warehouse_id', 'variant_id'], 'stock_levels_warehouse_variant_uq');
            $t->index(['tenant_id', 'variant_id'], 'stock_levels_variant_idx');
            $t->foreign(['tenant_id', 'warehouse_id'], 'stock_levels_warehouse_fk')->references(['tenant_id', 'id'])->on('warehouses');
            $t->foreign(['tenant_id', 'variant_id'], 'stock_levels_variant_fk')->references(['tenant_id', 'id'])->on('product_variants');
        });

        Schema::create('stock_movements', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('warehouse_id');
            $t->uuid('variant_id');
            $t->string('type', 20);
            $t->decimal('quantity', 14, 3);
            $t->decimal('balance_after', 14, 3);
            $t->decimal('unit_cost', 14, 4)->nullable();
            $t->string('reason', 200)->nullable();
            $t->string('source_type', 30);
            $t->uuid('source_id')->nullable();
            $t->uuid('source_line_id');
            $t->uuid('user_id')->nullable();
            $t->dateTime('occurred_at', 6);
            $t->unique(['tenant_id', 'id'], 'stock_movements_tenant_id_uq');
            // Un reintento de la misma operación no duplica el movimiento.
            $t->unique(['tenant_id', 'source_type', 'source_line_id', 'type'], 'stock_movements_source_uq');
            $t->index(['tenant_id', 'variant_id', 'occurred_at'], 'stock_movements_variant_idx');
            $t->index(['tenant_id', 'warehouse_id', 'occurred_at'], 'stock_movements_warehouse_idx');
            $t->foreign(['tenant_id', 'warehouse_id'], 'stock_movements_warehouse_fk')->references(['tenant_id', 'id'])->on('warehouses');
            $t->foreign(['tenant_id', 'variant_id'], 'stock_movements_variant_fk')->references(['tenant_id', 'id'])->on('product_variants');
            $t->foreign('user_id')->references('id')->on('users');
        });

        Schema::create('stock_counts', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('warehouse_id');
            $t->string('scope', 20);
            $t->string('status', 20)->default('open');
            $t->string('notes', 300)->nullable();
            $t->uuid('created_by');
            $t->uuid('closed_by')->nullable();
            $t->dateTime('closed_at', 6)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            // Un solo recuento abierto por depósito.
            $t->boolean('open_flag')->nullable()->storedAs("IF(status = 'open', 1, NULL)");
            $t->unique(['warehouse_id', 'open_flag'], 'stock_counts_one_open_uq');
            $t->unique(['tenant_id', 'id'], 'stock_counts_tenant_id_uq');
            $t->foreign(['tenant_id', 'warehouse_id'], 'stock_counts_warehouse_fk')->references(['tenant_id', 'id'])->on('warehouses');
            $t->foreign('created_by')->references('id')->on('users');
            $t->foreign('closed_by')->references('id')->on('users');
        });

        Schema::create('stock_count_lines', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('count_id');
            $t->uuid('variant_id');
            // Stock que figuraba en el momento de contar: la diferencia se calcula contra este valor,
            // así las ventas hechas mientras dura el recuento no se toman como faltante.
            $t->decimal('expected', 14, 3);
            $t->decimal('counted', 14, 3);
            $t->uuid('counted_by');
            $t->dateTime('counted_at', 6);
            $t->unique(['tenant_id', 'id'], 'stock_count_lines_tenant_id_uq');
            $t->unique(['count_id', 'variant_id'], 'stock_count_lines_variant_uq');
            $t->foreign(['tenant_id', 'count_id'], 'stock_count_lines_count_fk')->references(['tenant_id', 'id'])->on('stock_counts');
            $t->foreign(['tenant_id', 'variant_id'], 'stock_count_lines_variant_fk')->references(['tenant_id', 'id'])->on('product_variants');
            $t->foreign('counted_by')->references('id')->on('users');
        });

        $checks = [
            'categories' => ['categories_status_ck', "status IN ('active', 'inactive')"],
            'products' => ['products_values_ck', "kind IN ('good', 'service') AND sale_mode IN ('unit', 'weight', 'length', 'volume')
                AND status IN ('active', 'inactive') AND vat_rate IN ('21', '10.5', '27', '5', '2.5', '0', 'exento', 'no_gravado')
                AND (kind = 'good' OR track_stock = 0) AND (min_stock IS NULL OR min_stock >= 0)"],
            'product_variants' => ['product_variants_values_ck', "price >= 0 AND (cost IS NULL OR cost >= 0) AND status IN ('active', 'inactive')"],
            'barcodes' => ['barcodes_factor_ck', 'quantity_factor > 0'],
            'variant_prices' => ['variant_prices_price_ck', 'price >= 0'],
            'variant_costs' => ['variant_costs_values_ck', "cost >= 0 AND source IN ('manual', 'purchase', 'import', 'initial')"],
            'stock_movements' => ['stock_movements_type_ck', "type IN ('adjust', 'waste', 'expired', 'count_adjust', 'purchase_in', 'sale_out', 'return_in', 'transfer_out', 'transfer_in') AND quantity <> 0"],
            'stock_counts' => ['stock_counts_values_ck', "scope IN ('total', 'partial') AND status IN ('open', 'closed', 'cancelled')"],
            'stock_count_lines' => ['stock_count_lines_counted_ck', 'counted >= 0'],
        ];
        foreach ($checks as $table => [$name, $expr]) {
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$name} CHECK ({$expr})");
        }

        foreach (self::APPEND_ONLY as $table) {
            DB::unprepared("CREATE TRIGGER {$table}_no_update BEFORE UPDATE ON {$table} FOR EACH ROW
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{$table} es de solo agregado: no se permite UPDATE'");
            DB::unprepared("CREATE TRIGGER {$table}_no_delete BEFORE DELETE ON {$table} FOR EACH ROW
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{$table} es de solo agregado: no se permite DELETE'");
        }

        // Los comercios que ya existían reciben las categorías iniciales de su rubro.
        $now = Carbon::now()->format('Y-m-d H:i:s.u');
        foreach (DB::table('tenants')->join('business_types', 'business_types.code', '=', 'tenants.business_type_code')
            ->get(['tenants.id', 'business_types.default_categories']) as $tenant) {
            $rows = array_map(fn ($name) => [
                'id' => (string) Str::uuid7(), 'tenant_id' => $tenant->id, 'name' => $name, 'status' => 'active',
                'created_at' => $now, 'updated_at' => $now,
            ], json_decode($tenant->default_categories, true) ?: []);
            DB::table('categories')->insert($rows);
        }
    }

    public function down(): void
    {
        foreach (self::APPEND_ONLY as $table) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$table}_no_update");
            DB::unprepared("DROP TRIGGER IF EXISTS {$table}_no_delete");
        }
        foreach ([
            'stock_count_lines', 'stock_counts', 'stock_movements', 'stock_levels', 'variant_costs', 'variant_prices',
            'price_change_batches', 'barcodes', 'product_variants', 'products', 'brands', 'categories',
        ] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
