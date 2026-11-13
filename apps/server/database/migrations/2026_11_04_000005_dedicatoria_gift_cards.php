<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/* Dedicatoria opcional de la gift card: se imprime en la tarjeta de regalo. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('gift_cards', function (Blueprint $t) {
            $t->string('message', 200)->nullable()->after('from_name');
        });
    }

    public function down(): void
    {
        Schema::table('gift_cards', function (Blueprint $t) {
            $t->dropColumn('message');
        });
    }
};
