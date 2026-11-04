<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Precio de contado (ADR 0023): cada variante puede tener un precio para efectivo (o los medios
 * que el comercio marque como contado), distinto del de lista. La venta guarda con qué lista se
 * cobró.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_variants', function (Blueprint $t) {
            $t->decimal('cash_price', 14, 2)->nullable()->after('price');
        });
        Schema::table('payment_methods', function (Blueprint $t) {
            $t->boolean('cash_price')->default(false)->after('requires_reference');
        });
        DB::table('payment_methods')->where('kind', 'cash')->update(['cash_price' => true]);
        Schema::table('sales', function (Blueprint $t) {
            $t->string('price_list', 10)->default('list')->after('kind');
        });
    }

    public function down(): void
    {
        Schema::table('sales', fn (Blueprint $t) => $t->dropColumn('price_list'));
        Schema::table('payment_methods', fn (Blueprint $t) => $t->dropColumn('cash_price'));
        Schema::table('product_variants', fn (Blueprint $t) => $t->dropColumn('cash_price'));
    }
};
