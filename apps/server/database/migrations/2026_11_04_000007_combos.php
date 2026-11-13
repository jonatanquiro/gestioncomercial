<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Combos (ADR 0024): una promoción con varios productos y un precio para el conjunto
 * («salchichas + pan de viena + mayonesa por $X»). La caja la aplica sola cuando están todos.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('promotions', function (Blueprint $t) {
            $t->decimal('combo_price', 14, 2)->nullable()->after('pay_quantity');
        });
        DB::statement('ALTER TABLE promotions DROP CONSTRAINT promotions_values_ck');
        DB::statement("ALTER TABLE promotions ADD CONSTRAINT promotions_values_ck CHECK (
            status IN ('active', 'inactive')
            AND ((kind = 'percent' AND percent > 0 AND percent <= 100)
                OR (kind = 'nxm' AND buy_quantity >= 2 AND pay_quantity >= 1 AND pay_quantity < buy_quantity)
                OR (kind = 'combo' AND combo_price >= 0 AND scope = 'all'))
            AND ((scope = 'all') OR (scope = 'category' AND category_id IS NOT NULL) OR (scope = 'product' AND product_id IS NOT NULL))
            AND (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on))");

        Schema::create('promotion_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('promotion_id');
            $t->uuid('product_id');
            $t->unsignedSmallInteger('quantity');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'promotion_items_tenant_id_uq');
            $t->unique(['promotion_id', 'product_id'], 'promotion_items_product_uq');
            $t->foreign('tenant_id')->references('id')->on('tenants');
            $t->foreign(['tenant_id', 'promotion_id'], 'promotion_items_promotion_fk')->references(['tenant_id', 'id'])->on('promotions');
            $t->foreign(['tenant_id', 'product_id'], 'promotion_items_product_fk')->references(['tenant_id', 'id'])->on('products');
        });
        DB::statement('ALTER TABLE promotion_items ADD CONSTRAINT promotion_items_quantity_ck CHECK (quantity BETWEEN 1 AND 99)');
    }

    public function down(): void
    {
        Schema::dropIfExists('promotion_items');
        DB::statement('ALTER TABLE promotions DROP CONSTRAINT promotions_values_ck');
        DB::statement("ALTER TABLE promotions ADD CONSTRAINT promotions_values_ck CHECK (
            status IN ('active', 'inactive')
            AND ((kind = 'percent' AND percent > 0 AND percent <= 100) OR (kind = 'nxm' AND buy_quantity >= 2 AND pay_quantity >= 1 AND pay_quantity < buy_quantity))
            AND ((scope = 'all') OR (scope = 'category' AND category_id IS NOT NULL) OR (scope = 'product' AND product_id IS NOT NULL))
            AND (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on))");
        Schema::table('promotions', fn (Blueprint $t) => $t->dropColumn('combo_price'));
    }
};
