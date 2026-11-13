<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Promociones (ADR 0020): porcentaje de descuento o N×M sobre todo, una categoría o un producto,
 * con fechas de vigencia. Las calcula el servidor al vender; la línea guarda qué promoción se
 * aplicó y cuánto descontó, aparte del descuento manual.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promotions', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('name', 80);
            // percent: porcentaje de descuento · nxm: lleva N y paga M.
            $t->string('kind', 20);
            $t->decimal('percent', 5, 2)->nullable();
            $t->unsignedSmallInteger('buy_quantity')->nullable();
            $t->unsignedSmallInteger('pay_quantity')->nullable();
            // all · category · product
            $t->string('scope', 20);
            $t->uuid('category_id')->nullable();
            $t->uuid('product_id')->nullable();
            $t->date('starts_on')->nullable();
            $t->date('ends_on')->nullable();
            $t->string('status', 20)->default('active');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'promotions_tenant_id_uq');
            $t->index(['tenant_id', 'status'], 'promotions_status_idx');
            $t->foreign('tenant_id')->references('id')->on('tenants');
            $t->foreign(['tenant_id', 'category_id'], 'promotions_category_fk')->references(['tenant_id', 'id'])->on('categories');
            $t->foreign(['tenant_id', 'product_id'], 'promotions_product_fk')->references(['tenant_id', 'id'])->on('products');
        });
        DB::statement("ALTER TABLE promotions ADD CONSTRAINT promotions_values_ck CHECK (
            status IN ('active', 'inactive')
            AND ((kind = 'percent' AND percent > 0 AND percent <= 100) OR (kind = 'nxm' AND buy_quantity >= 2 AND pay_quantity >= 1 AND pay_quantity < buy_quantity))
            AND ((scope = 'all') OR (scope = 'category' AND category_id IS NOT NULL) OR (scope = 'product' AND product_id IS NOT NULL))
            AND (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on))");

        Schema::table('sale_lines', function (Blueprint $t) {
            $t->uuid('promotion_id')->nullable()->after('discount_amount');
            $t->decimal('promotion_discount', 14, 2)->default(0)->after('promotion_id');
            $t->foreign(['tenant_id', 'promotion_id'], 'sale_lines_promotion_fk')->references(['tenant_id', 'id'])->on('promotions');
        });
    }

    public function down(): void
    {
        Schema::table('sale_lines', function (Blueprint $t) {
            $t->dropForeign('sale_lines_promotion_fk');
            $t->dropColumn(['promotion_id', 'promotion_discount']);
        });
        Schema::dropIfExists('promotions');
    }
};
