<?php

use App\Services\SalesSetup;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/*
 * Fase 4: punto de venta y caja (secciones 7 y 9 del diseño).
 *
 * - Una venta se confirma en una sola transacción: venta, líneas, pagos, stock y caja, o nada.
 *   UNIQUE (tenant_id, client_uuid) hace que un reintento devuelva la venta ya registrada.
 * - Las líneas copian descripción, precio, costo e IVA: el historial no cambia si cambia el producto.
 * - Cada caja tiene a lo sumo un turno abierto. Un turno cerrado no se puede modificar
 *   (disparador) y sus movimientos y arqueos son de solo agregado.
 * - La numeración sale de document_sequences, bloqueada con FOR UPDATE.
 * - Una venta no se borra: se anula, con movimientos inversos de stock y caja.
 */
return new class extends Migration
{
    private const APPEND_ONLY = ['cash_movements', 'cash_counts'];

    public function up(): void
    {
        Schema::table('memberships', function (Blueprint $t) {
            // PIN para autorizar en el punto de venta (anulaciones, devoluciones, descuentos).
            $t->string('pos_pin_hash', 255)->nullable()->after('status');
        });

        Schema::create('registers', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('branch_id');
            $t->string('name', 60);
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'registers_tenant_id_uq');
            $t->unique(['tenant_id', 'branch_id', 'name'], 'registers_branch_name_uq');
            $t->foreign(['tenant_id', 'branch_id'], 'registers_branch_fk')->references(['tenant_id', 'id'])->on('branches');
        });

        Schema::create('payment_methods', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('name', 60);
            $t->string('kind', 20);
            $t->boolean('requires_reference')->default(false);
            $t->boolean('active')->default(true);
            $t->unsignedInteger('sort_order')->default(0);
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'payment_methods_tenant_id_uq');
            $t->unique(['tenant_id', 'name'], 'payment_methods_tenant_name_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
        });

        Schema::create('document_sequences', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('branch_id');
            $t->string('doc_type', 20);
            $t->unsignedBigInteger('next_number')->default(1);
            $t->unique(['tenant_id', 'id'], 'document_sequences_tenant_id_uq');
            $t->unique(['tenant_id', 'branch_id', 'doc_type'], 'document_sequences_branch_type_uq');
            $t->foreign(['tenant_id', 'branch_id'], 'document_sequences_branch_fk')->references(['tenant_id', 'id'])->on('branches');
        });

        Schema::create('cash_shifts', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('register_id');
            $t->string('status', 20)->default('open');
            $t->decimal('opening_float', 14, 2);
            $t->uuid('opened_by');
            $t->dateTime('opened_at', 6);
            $t->uuid('closed_by')->nullable();
            $t->dateTime('closed_at', 6)->nullable();
            $t->decimal('expected_cash', 14, 2)->nullable();
            $t->decimal('counted_cash', 14, 2)->nullable();
            $t->decimal('difference', 14, 2)->nullable();
            $t->json('totals_by_method')->nullable();
            $t->string('closing_notes', 300)->nullable();
            // Un solo turno abierto por caja.
            $t->boolean('open_flag')->nullable()->storedAs("IF(status = 'open', 1, NULL)");
            $t->unique(['register_id', 'open_flag'], 'cash_shifts_one_open_uq');
            $t->unique(['tenant_id', 'id'], 'cash_shifts_tenant_id_uq');
            $t->index(['tenant_id', 'opened_at'], 'cash_shifts_opened_idx');
            $t->foreign(['tenant_id', 'register_id'], 'cash_shifts_register_fk')->references(['tenant_id', 'id'])->on('registers');
            $t->foreign('opened_by')->references('id')->on('users');
            $t->foreign('closed_by')->references('id')->on('users');
        });

        Schema::create('cash_movements', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('shift_id');
            $t->string('type', 20);
            $t->decimal('amount', 14, 2);
            $t->string('reason', 200)->nullable();
            $t->string('source_type', 30)->nullable();
            $t->uuid('source_id')->nullable();
            $t->uuid('user_id');
            $t->uuid('authorized_by')->nullable();
            $t->dateTime('occurred_at', 6);
            $t->unique(['tenant_id', 'id'], 'cash_movements_tenant_id_uq');
            $t->index(['tenant_id', 'shift_id', 'occurred_at'], 'cash_movements_shift_idx');
            $t->foreign(['tenant_id', 'shift_id'], 'cash_movements_shift_fk')->references(['tenant_id', 'id'])->on('cash_shifts');
            $t->foreign('user_id')->references('id')->on('users');
            $t->foreign('authorized_by')->references('id')->on('users');
        });

        Schema::create('cash_counts', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('shift_id');
            $t->string('kind', 20);
            $t->decimal('counted', 14, 2);
            $t->decimal('expected', 14, 2);
            $t->uuid('counted_by');
            $t->dateTime('counted_at', 6);
            $t->unique(['tenant_id', 'id'], 'cash_counts_tenant_id_uq');
            $t->foreign(['tenant_id', 'shift_id'], 'cash_counts_shift_fk')->references(['tenant_id', 'id'])->on('cash_shifts');
            $t->foreign('counted_by')->references('id')->on('users');
        });

        Schema::create('sales', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('branch_id');
            $t->uuid('register_id');
            $t->uuid('shift_id');
            $t->uuid('warehouse_id');
            $t->unsignedBigInteger('number');
            $t->uuid('client_uuid');
            $t->string('status', 20)->default('confirmed');
            $t->uuid('cashier_id');
            $t->decimal('subtotal', 14, 2);
            $t->decimal('discount_total', 14, 2);
            $t->decimal('total', 14, 2);
            $t->decimal('change_given', 14, 2)->default(0);
            $t->uuid('discount_authorized_by')->nullable();
            $t->dateTime('confirmed_at', 6);
            $t->dateTime('voided_at', 6)->nullable();
            $t->uuid('voided_by')->nullable();
            $t->uuid('void_authorized_by')->nullable();
            $t->string('void_reason', 200)->nullable();
            $t->unique(['tenant_id', 'id'], 'sales_tenant_id_uq');
            $t->unique(['tenant_id', 'client_uuid'], 'sales_client_uuid_uq');
            $t->unique(['tenant_id', 'branch_id', 'number'], 'sales_branch_number_uq');
            $t->index(['tenant_id', 'confirmed_at'], 'sales_confirmed_idx');
            $t->index(['tenant_id', 'shift_id'], 'sales_shift_idx');
            $t->foreign(['tenant_id', 'branch_id'], 'sales_branch_fk')->references(['tenant_id', 'id'])->on('branches');
            $t->foreign(['tenant_id', 'register_id'], 'sales_register_fk')->references(['tenant_id', 'id'])->on('registers');
            $t->foreign(['tenant_id', 'shift_id'], 'sales_shift_fk')->references(['tenant_id', 'id'])->on('cash_shifts');
            $t->foreign(['tenant_id', 'warehouse_id'], 'sales_warehouse_fk')->references(['tenant_id', 'id'])->on('warehouses');
            $t->foreign('cashier_id')->references('id')->on('users');
            $t->foreign('voided_by')->references('id')->on('users');
            $t->foreign('void_authorized_by')->references('id')->on('users');
            $t->foreign('discount_authorized_by')->references('id')->on('users');
        });

        Schema::create('sale_lines', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('sale_id');
            $t->unsignedSmallInteger('line_no');
            $t->uuid('variant_id');
            $t->string('description', 160);
            $t->string('sale_mode', 20);
            $t->decimal('quantity', 14, 3);
            $t->decimal('unit_price', 14, 2);
            $t->decimal('unit_cost', 14, 4)->nullable();
            $t->decimal('discount_percent', 5, 2)->default(0);
            $t->decimal('discount_amount', 14, 2)->default(0);
            $t->string('vat_rate', 20);
            $t->decimal('line_total', 14, 2);
            $t->decimal('returned_quantity', 14, 3)->default(0);
            $t->unique(['tenant_id', 'id'], 'sale_lines_tenant_id_uq');
            $t->unique(['sale_id', 'line_no'], 'sale_lines_line_uq');
            $t->foreign(['tenant_id', 'sale_id'], 'sale_lines_sale_fk')->references(['tenant_id', 'id'])->on('sales');
            $t->foreign(['tenant_id', 'variant_id'], 'sale_lines_variant_fk')->references(['tenant_id', 'id'])->on('product_variants');
        });

        Schema::create('sale_payments', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('sale_id');
            $t->uuid('payment_method_id');
            $t->string('kind', 20);
            $t->decimal('amount', 14, 2);
            $t->string('status', 20);
            $t->string('reference', 80)->nullable();
            $t->uuid('confirmed_by')->nullable();
            $t->unique(['tenant_id', 'id'], 'sale_payments_tenant_id_uq');
            $t->index(['tenant_id', 'sale_id'], 'sale_payments_sale_idx');
            $t->foreign(['tenant_id', 'sale_id'], 'sale_payments_sale_fk')->references(['tenant_id', 'id'])->on('sales');
            $t->foreign(['tenant_id', 'payment_method_id'], 'sale_payments_method_fk')->references(['tenant_id', 'id'])->on('payment_methods');
            $t->foreign('confirmed_by')->references('id')->on('users');
        });

        Schema::create('sale_returns', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('sale_id');
            $t->uuid('client_uuid');
            $t->unsignedBigInteger('number');
            $t->uuid('branch_id');
            $t->uuid('shift_id');
            $t->string('reason', 200);
            $t->uuid('payment_method_id');
            $t->decimal('total', 14, 2);
            $t->uuid('user_id');
            $t->uuid('authorized_by')->nullable();
            $t->dateTime('created_at', 6);
            $t->unique(['tenant_id', 'id'], 'sale_returns_tenant_id_uq');
            $t->unique(['tenant_id', 'client_uuid'], 'sale_returns_client_uuid_uq');
            $t->unique(['tenant_id', 'branch_id', 'number'], 'sale_returns_branch_number_uq');
            $t->foreign(['tenant_id', 'sale_id'], 'sale_returns_sale_fk')->references(['tenant_id', 'id'])->on('sales');
            $t->foreign(['tenant_id', 'shift_id'], 'sale_returns_shift_fk')->references(['tenant_id', 'id'])->on('cash_shifts');
            $t->foreign(['tenant_id', 'payment_method_id'], 'sale_returns_method_fk')->references(['tenant_id', 'id'])->on('payment_methods');
            $t->foreign('user_id')->references('id')->on('users');
            $t->foreign('authorized_by')->references('id')->on('users');
        });

        Schema::create('sale_return_lines', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('return_id');
            $t->uuid('sale_line_id');
            $t->decimal('quantity', 14, 3);
            $t->decimal('amount', 14, 2);
            $t->boolean('restock');
            $t->unique(['tenant_id', 'id'], 'sale_return_lines_tenant_id_uq');
            $t->foreign(['tenant_id', 'return_id'], 'sale_return_lines_return_fk')->references(['tenant_id', 'id'])->on('sale_returns');
            $t->foreign(['tenant_id', 'sale_line_id'], 'sale_return_lines_line_fk')->references(['tenant_id', 'id'])->on('sale_lines');
        });

        $checks = [
            'registers' => ['registers_status_ck', "status IN ('active', 'inactive')"],
            'payment_methods' => ['payment_methods_kind_ck', "kind IN ('cash', 'debit', 'credit', 'transfer', 'qr', 'other')"],
            'cash_shifts' => ['cash_shifts_values_ck', "status IN ('open', 'closed') AND opening_float >= 0"],
            'cash_movements' => ['cash_movements_values_ck', "type IN ('sale', 'refund', 'void', 'withdrawal', 'deposit') AND amount <> 0"],
            'cash_counts' => ['cash_counts_values_ck', "kind IN ('partial', 'closing') AND counted >= 0"],
            'sales' => ['sales_values_ck', "status IN ('confirmed', 'voided') AND total >= 0 AND subtotal >= 0 AND discount_total >= 0 AND change_given >= 0"],
            'sale_lines' => ['sale_lines_values_ck', 'quantity > 0 AND unit_price >= 0 AND discount_percent BETWEEN 0 AND 100 AND line_total >= 0 AND returned_quantity BETWEEN 0 AND quantity'],
            'sale_payments' => ['sale_payments_values_ck', "amount > 0 AND status IN ('cash', 'confirmed')"],
            'sale_return_lines' => ['sale_return_lines_values_ck', 'quantity > 0 AND amount >= 0'],
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
        // Un turno cerrado queda fijo: ni el cierre ni sus importes se pueden cambiar después.
        DB::unprepared("CREATE TRIGGER cash_shifts_closed_is_final BEFORE UPDATE ON cash_shifts FOR EACH ROW
            BEGIN
                IF OLD.status = 'closed' THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un turno de caja cerrado no se puede modificar';
                END IF;
            END");
        DB::unprepared("CREATE TRIGGER cash_shifts_no_delete BEFORE DELETE ON cash_shifts FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los turnos de caja no se borran'");

        // Comercios existentes: una caja por sucursal y los medios de pago habituales.
        $now = Carbon::now()->format('Y-m-d H:i:s.u');
        foreach (DB::table('branches')->get(['id', 'tenant_id']) as $branch) {
            DB::table('registers')->insert(['id' => (string) Str::uuid7(), 'tenant_id' => $branch->tenant_id, 'branch_id' => $branch->id, 'name' => 'Caja 1', 'status' => 'active', 'created_at' => $now, 'updated_at' => $now]);
            foreach (SalesSetup::DOC_TYPES as $type) {
                DB::table('document_sequences')->insert(['id' => (string) Str::uuid7(), 'tenant_id' => $branch->tenant_id, 'branch_id' => $branch->id, 'doc_type' => $type, 'next_number' => 1]);
            }
        }
        foreach (DB::table('tenants')->pluck('id') as $tenantId) {
            DB::table('payment_methods')->insert(array_map(fn ($m) => [
                'id' => (string) Str::uuid7(), 'tenant_id' => $tenantId, 'name' => $m[0], 'kind' => $m[1], 'requires_reference' => $m[2],
                'active' => true, 'sort_order' => $m[3], 'created_at' => $now, 'updated_at' => $now,
            ], SalesSetup::DEFAULT_PAYMENT_METHODS));
        }
    }

    public function down(): void
    {
        foreach ([...self::APPEND_ONLY, 'cash_shifts'] as $table) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$table}_no_update");
            DB::unprepared("DROP TRIGGER IF EXISTS {$table}_no_delete");
        }
        DB::unprepared('DROP TRIGGER IF EXISTS cash_shifts_closed_is_final');
        foreach ([
            'sale_return_lines', 'sale_returns', 'sale_payments', 'sale_lines', 'sales', 'cash_counts', 'cash_movements',
            'cash_shifts', 'document_sequences', 'payment_methods', 'registers',
        ] as $table) {
            Schema::dropIfExists($table);
        }
        Schema::table('memberships', function (Blueprint $t) {
            $t->dropColumn('pos_pin_hash');
        });
    }
};
