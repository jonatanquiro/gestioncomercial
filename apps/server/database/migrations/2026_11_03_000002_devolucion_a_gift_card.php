<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Devolución de lo pagado con gift card (ADR 0015): vuelve a la tarjeta como saldo, no sale de
 * la caja. La devolución guarda cuánto fue a la tarjeta y el movimiento, a qué devolución responde.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_returns', function (Blueprint $t) {
            $t->decimal('gift_card_amount', 14, 2)->default(0)->after('total');
        });
        Schema::table('gift_card_movements', function (Blueprint $t) {
            $t->uuid('sale_return_id')->nullable()->after('sale_id');
            $t->foreign(['tenant_id', 'sale_return_id'], 'gift_card_movements_return_fk')->references(['tenant_id', 'id'])->on('sale_returns');
        });
        DB::statement('ALTER TABLE gift_card_movements DROP CONSTRAINT gift_card_movements_values_ck');
        DB::statement("ALTER TABLE gift_card_movements ADD CONSTRAINT gift_card_movements_values_ck CHECK (kind IN ('issue', 'redeem', 'reversal', 'void', 'refund') AND balance_after >= 0)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE gift_card_movements DROP CONSTRAINT gift_card_movements_values_ck');
        DB::statement("ALTER TABLE gift_card_movements ADD CONSTRAINT gift_card_movements_values_ck CHECK (kind IN ('issue', 'redeem', 'reversal', 'void') AND balance_after >= 0)");
        Schema::table('gift_card_movements', function (Blueprint $t) {
            $t->dropForeign('gift_card_movements_return_fk');
            $t->dropColumn('sale_return_id');
        });
        Schema::table('sale_returns', function (Blueprint $t) {
            $t->dropColumn('gift_card_amount');
        });
    }
};
