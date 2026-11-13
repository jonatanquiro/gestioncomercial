<?php

use App\Support\Triggers;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Cuenta corriente con proveedores (ADR 0018). Una compra puede dejar un importe a pagar y los
 * pagos lo bajan; el pago en efectivo sale de una caja abierta. El saldo se mueve con registros
 * de solo agregado; el proveedor guarda el saldo vigente para bloquearlo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('suppliers', function (Blueprint $t) {
            // Positivo: lo que se le debe. Negativo: saldo a favor (pagos adelantados).
            $t->decimal('balance', 14, 2)->default(0)->after('notes');
        });
        Schema::table('purchases', function (Blueprint $t) {
            // Lo que la compra dejó para pagar al proveedor (la factura, con impuestos); null: no quedó deuda.
            $t->decimal('payable_amount', 14, 2)->nullable()->after('total_cost');
        });

        Schema::create('supplier_movements', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('supplier_id');
            // purchase: compra a pagar · payment: pago · adjustment: saldo inicial o corrección.
            $t->string('kind', 20);
            $t->decimal('amount', 14, 2);
            $t->decimal('balance_after', 14, 2);
            $t->uuid('purchase_id')->nullable();
            // Pago: cash (de una caja), transfer, check u other.
            $t->string('method', 20)->nullable();
            $t->uuid('shift_id')->nullable();
            $t->string('reference', 80)->nullable();
            $t->string('notes', 200)->nullable();
            $t->uuid('client_uuid')->nullable();
            $t->uuid('user_id');
            $t->dateTime('created_at', 6);
            $t->unique(['tenant_id', 'id'], 'supplier_movements_tenant_id_uq');
            $t->unique(['tenant_id', 'client_uuid'], 'supplier_movements_client_uuid_uq');
            $t->index(['tenant_id', 'supplier_id', 'created_at'], 'supplier_movements_supplier_idx');
            $t->foreign(['tenant_id', 'supplier_id'], 'supplier_movements_supplier_fk')->references(['tenant_id', 'id'])->on('suppliers');
            $t->foreign(['tenant_id', 'purchase_id'], 'supplier_movements_purchase_fk')->references(['tenant_id', 'id'])->on('purchases');
            $t->foreign(['tenant_id', 'shift_id'], 'supplier_movements_shift_fk')->references(['tenant_id', 'id'])->on('cash_shifts');
            $t->foreign('user_id')->references('id')->on('users');
        });

        DB::statement("ALTER TABLE supplier_movements ADD CONSTRAINT supplier_movements_values_ck CHECK (kind IN ('purchase', 'payment', 'adjustment') AND amount <> 0 AND (method IS NULL OR method IN ('cash', 'transfer', 'check', 'other')))");
        DB::statement('ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_values_ck');
        DB::statement("ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_values_ck CHECK (type IN ('sale', 'refund', 'void', 'withdrawal', 'deposit', 'supplier_payment') AND amount <> 0)");
        Triggers::create('supplier_movements_no_update', fn () => DB::unprepared("CREATE TRIGGER supplier_movements_no_update BEFORE UPDATE ON supplier_movements FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'supplier_movements es de solo agregado: no se permite UPDATE'"));
        Triggers::create('supplier_movements_no_delete', fn () => DB::unprepared("CREATE TRIGGER supplier_movements_no_delete BEFORE DELETE ON supplier_movements FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'supplier_movements es de solo agregado: no se permite DELETE'"));
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS supplier_movements_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS supplier_movements_no_delete');
        DB::statement('ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_values_ck');
        DB::statement("ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_values_ck CHECK (type IN ('sale', 'refund', 'void', 'withdrawal', 'deposit') AND amount <> 0)");
        Schema::dropIfExists('supplier_movements');
        Schema::table('purchases', fn (Blueprint $t) => $t->dropColumn('payable_amount'));
        Schema::table('suppliers', fn (Blueprint $t) => $t->dropColumn('balance'));
    }
};
