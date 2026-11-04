<?php

use App\Support\Triggers;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Clientes y cuenta corriente (ADR 0016). Una venta puede tener cliente y pagarse en todo o en
 * parte «a cuenta» (fiado). El cobro de la deuda es una venta sin artículos de tipo
 * account_payment, que entra a la caja y a cobros como cualquier venta. El saldo se mueve con
 * registros de solo agregado; el cliente guarda el saldo vigente para bloquearlo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('name', 120);
            // 80 CUIT · 86 CUIL · 96 DNI (códigos de ARCA)
            $t->unsignedSmallInteger('document_type')->nullable();
            $t->string('document_number', 11)->nullable();
            // Condición frente al IVA con el código de ARCA (5 consumidor final, 1 RI, 6 monotributo, 4 exento).
            $t->unsignedSmallInteger('vat_condition')->default(5);
            $t->string('phone', 30)->nullable();
            $t->string('email', 254)->nullable();
            $t->string('address', 200)->nullable();
            $t->string('notes', 300)->nullable();
            // Tope de deuda en cuenta corriente; null: no se le vende a cuenta.
            $t->decimal('credit_limit', 14, 2)->nullable();
            // Positivo: lo que debe. Negativo: saldo a favor.
            $t->decimal('balance', 14, 2)->default(0);
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'customers_tenant_id_uq');
            $t->unique(['tenant_id', 'document_number'], 'customers_document_uq');
            $t->index(['tenant_id', 'name'], 'customers_name_idx');
            $t->foreign('tenant_id')->references('id')->on('tenants');
        });

        Schema::create('customer_movements', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('customer_id');
            // sale: compra a cuenta · payment: cobro · return: devolución · void: anulación · adjustment: saldo inicial o corrección.
            $t->string('kind', 20);
            $t->decimal('amount', 14, 2);
            $t->decimal('balance_after', 14, 2);
            $t->uuid('sale_id')->nullable();
            $t->uuid('sale_return_id')->nullable();
            $t->string('notes', 200)->nullable();
            $t->uuid('user_id');
            $t->dateTime('created_at', 6);
            $t->unique(['tenant_id', 'id'], 'customer_movements_tenant_id_uq');
            $t->index(['tenant_id', 'customer_id', 'created_at'], 'customer_movements_customer_idx');
            $t->index(['tenant_id', 'sale_id'], 'customer_movements_sale_idx');
            $t->foreign(['tenant_id', 'customer_id'], 'customer_movements_customer_fk')->references(['tenant_id', 'id'])->on('customers');
            $t->foreign(['tenant_id', 'sale_id'], 'customer_movements_sale_fk')->references(['tenant_id', 'id'])->on('sales');
            $t->foreign(['tenant_id', 'sale_return_id'], 'customer_movements_return_fk')->references(['tenant_id', 'id'])->on('sale_returns');
            $t->foreign('user_id')->references('id')->on('users');
        });

        Schema::table('sales', function (Blueprint $t) {
            $t->string('kind', 20)->default('sale')->after('status');
            $t->uuid('customer_id')->nullable()->after('kind');
            $t->index(['tenant_id', 'customer_id'], 'sales_customer_idx');
            $t->foreign(['tenant_id', 'customer_id'], 'sales_customer_fk')->references(['tenant_id', 'id'])->on('customers');
        });
        DB::statement("UPDATE sales SET kind = 'gift_card' WHERE id IN (SELECT sale_id FROM gift_cards)");
        DB::statement("ALTER TABLE sales ADD CONSTRAINT sales_kind_ck CHECK (kind IN ('sale', 'gift_card', 'account_payment'))");

        Schema::table('sale_returns', function (Blueprint $t) {
            $t->decimal('account_amount', 14, 2)->default(0)->after('gift_card_amount');
        });

        DB::statement('ALTER TABLE payment_methods DROP CONSTRAINT payment_methods_kind_ck');
        DB::statement("ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_kind_ck CHECK (kind IN ('cash', 'debit', 'credit', 'transfer', 'qr', 'other', 'exchange', 'gift_card', 'account'))");
        DB::statement("ALTER TABLE customers ADD CONSTRAINT customers_values_ck CHECK (status IN ('active', 'inactive') AND (credit_limit IS NULL OR credit_limit >= 0) AND (document_type IS NULL OR document_type IN (80, 86, 96)))");
        DB::statement("ALTER TABLE customer_movements ADD CONSTRAINT customer_movements_values_ck CHECK (kind IN ('sale', 'payment', 'return', 'void', 'adjustment') AND amount <> 0)");
        Triggers::create('customer_movements_no_update', fn () => DB::unprepared("CREATE TRIGGER customer_movements_no_update BEFORE UPDATE ON customer_movements FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'customer_movements es de solo agregado: no se permite UPDATE'"));
        Triggers::create('customer_movements_no_delete', fn () => DB::unprepared("CREATE TRIGGER customer_movements_no_delete BEFORE DELETE ON customer_movements FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'customer_movements es de solo agregado: no se permite DELETE'"));
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS customer_movements_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS customer_movements_no_delete');
        DB::statement('ALTER TABLE payment_methods DROP CONSTRAINT payment_methods_kind_ck');
        DB::statement("ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_kind_ck CHECK (kind IN ('cash', 'debit', 'credit', 'transfer', 'qr', 'other', 'exchange', 'gift_card'))");
        Schema::table('sale_returns', fn (Blueprint $t) => $t->dropColumn('account_amount'));
        DB::statement('ALTER TABLE sales DROP CONSTRAINT sales_kind_ck');
        Schema::table('sales', function (Blueprint $t) {
            $t->dropForeign('sales_customer_fk');
            $t->dropIndex('sales_customer_idx');
            $t->dropColumn(['kind', 'customer_id']);
        });
        Schema::dropIfExists('customer_movements');
        Schema::dropIfExists('customers');
    }
};
