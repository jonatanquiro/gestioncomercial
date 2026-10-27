<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Nombre y teléfono de quien transfiere o paga con QR, para identificar el cobro. */
    public function up(): void
    {
        Schema::table('sale_payments', function (Blueprint $t) {
            $t->string('payer_name', 120)->nullable()->after('reference');
            $t->string('payer_phone', 30)->nullable()->after('payer_name');
        });
    }

    public function down(): void
    {
        Schema::table('sale_payments', function (Blueprint $t) {
            $t->dropColumn(['payer_name', 'payer_phone']);
        });
    }
};
