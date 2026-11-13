<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** El listado de cobros agrupa por medio de pago y N° de operación para detectar repetidos. */
    public function up(): void
    {
        Schema::table('sale_payments', function (Blueprint $t) {
            $t->index(['tenant_id', 'payment_method_id', 'reference'], 'sale_payments_reference_idx');
        });
    }

    public function down(): void
    {
        Schema::table('sale_payments', function (Blueprint $t) {
            $t->dropIndex('sale_payments_reference_idx');
        });
    }
};
