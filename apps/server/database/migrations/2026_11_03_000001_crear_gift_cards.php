<?php

use App\Support\Triggers;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Gift cards (ADR 0015): se venden como una venta sin artículos y se usan como medio de pago,
 * en una o varias compras, en cualquier sucursal, hasta que vencen. El saldo se mueve solo con
 * movimientos de solo agregado; la tarjeta guarda el saldo vigente para leerlo y bloquearlo.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE payment_methods DROP CONSTRAINT payment_methods_kind_ck');
        DB::statement("ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_kind_ck CHECK (kind IN ('cash', 'debit', 'credit', 'transfer', 'qr', 'other', 'exchange', 'gift_card'))");

        Schema::create('gift_cards', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('code', 20);
            // La venta en la que se cobró.
            $t->uuid('sale_id');
            $t->uuid('branch_id');
            $t->decimal('amount', 14, 2);
            $t->decimal('balance', 14, 2);
            $t->date('expires_on');
            $t->string('recipient_name', 80)->nullable();
            $t->string('from_name', 80)->nullable();
            $t->string('status', 20)->default('active');
            $t->uuid('created_by');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'gift_cards_tenant_id_uq');
            $t->unique(['tenant_id', 'code'], 'gift_cards_code_uq');
            $t->unique(['tenant_id', 'sale_id'], 'gift_cards_sale_uq');
            $t->index(['tenant_id', 'created_at'], 'gift_cards_created_idx');
            $t->foreign(['tenant_id', 'sale_id'], 'gift_cards_sale_fk')->references(['tenant_id', 'id'])->on('sales');
            $t->foreign(['tenant_id', 'branch_id'], 'gift_cards_branch_fk')->references(['tenant_id', 'id'])->on('branches');
            $t->foreign('created_by')->references('id')->on('users');
        });

        Schema::create('gift_card_movements', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('gift_card_id');
            // issue: emisión · redeem: pago de una venta · reversal: anulación de esa venta · void: anulación de la tarjeta.
            $t->string('kind', 20);
            $t->decimal('amount', 14, 2);
            $t->decimal('balance_after', 14, 2);
            $t->uuid('sale_id')->nullable();
            $t->uuid('branch_id');
            $t->uuid('user_id');
            $t->dateTime('created_at', 6);
            $t->unique(['tenant_id', 'id'], 'gift_card_movements_tenant_id_uq');
            $t->index(['tenant_id', 'gift_card_id', 'created_at'], 'gift_card_movements_card_idx');
            $t->index(['tenant_id', 'sale_id'], 'gift_card_movements_sale_idx');
            $t->foreign(['tenant_id', 'gift_card_id'], 'gift_card_movements_card_fk')->references(['tenant_id', 'id'])->on('gift_cards');
            $t->foreign(['tenant_id', 'sale_id'], 'gift_card_movements_sale_fk')->references(['tenant_id', 'id'])->on('sales');
            $t->foreign(['tenant_id', 'branch_id'], 'gift_card_movements_branch_fk')->references(['tenant_id', 'id'])->on('branches');
            $t->foreign('user_id')->references('id')->on('users');
        });

        DB::statement("ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_values_ck CHECK (amount > 0 AND balance >= 0 AND balance <= amount AND status IN ('active', 'voided'))");
        DB::statement("ALTER TABLE gift_card_movements ADD CONSTRAINT gift_card_movements_values_ck CHECK (kind IN ('issue', 'redeem', 'reversal', 'void') AND balance_after >= 0)");
        Triggers::create('gift_card_movements_no_update', fn () => DB::unprepared("CREATE TRIGGER gift_card_movements_no_update BEFORE UPDATE ON gift_card_movements FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'gift_card_movements es de solo agregado: no se permite UPDATE'"));
        Triggers::create('gift_card_movements_no_delete', fn () => DB::unprepared("CREATE TRIGGER gift_card_movements_no_delete BEFORE DELETE ON gift_card_movements FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'gift_card_movements es de solo agregado: no se permite DELETE'"));
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS gift_card_movements_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS gift_card_movements_no_delete');
        Schema::dropIfExists('gift_card_movements');
        Schema::dropIfExists('gift_cards');
        DB::statement('ALTER TABLE payment_methods DROP CONSTRAINT payment_methods_kind_ck');
        DB::statement("ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_kind_ck CHECK (kind IN ('cash', 'debit', 'credit', 'transfer', 'qr', 'other', 'exchange'))");
    }
};
