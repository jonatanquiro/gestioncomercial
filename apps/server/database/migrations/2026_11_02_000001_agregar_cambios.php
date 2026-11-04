<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Cambios (ADR 0014): lo devuelto queda como crédito y paga la venta nueva. El crédito usa un
 * medio de pago interno de tipo «exchange», que no mueve efectivo ni es un cobro a rendir, y la
 * venta nueva apunta a la devolución que lo originó.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE payment_methods DROP CONSTRAINT payment_methods_kind_ck');
        DB::statement("ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_kind_ck CHECK (kind IN ('cash', 'debit', 'credit', 'transfer', 'qr', 'other', 'exchange'))");

        Schema::table('sales', function (Blueprint $t) {
            $t->uuid('exchange_return_id')->nullable()->after('discount_authorized_by');
            $t->unique(['tenant_id', 'exchange_return_id'], 'sales_exchange_return_uq');
            $t->foreign(['tenant_id', 'exchange_return_id'], 'sales_exchange_return_fk')->references(['tenant_id', 'id'])->on('sale_returns');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $t) {
            $t->dropForeign('sales_exchange_return_fk');
            $t->dropUnique('sales_exchange_return_uq');
            $t->dropColumn('exchange_return_id');
        });
        DB::statement('ALTER TABLE payment_methods DROP CONSTRAINT payment_methods_kind_ck');
        DB::statement("ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_kind_ck CHECK (kind IN ('cash', 'debit', 'credit', 'transfer', 'qr', 'other'))");
    }
};
