<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Variantes de producto (ADR 0013): propiedades libres en el producto (Talle, Color) y sus valores
 * en cada variante, con una etiqueta legible única por producto. Un producto sin propiedades
 * conserva su única variante sin etiqueta.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $t) {
            $t->json('option_names')->nullable()->after('brand_id');
        });

        Schema::table('product_variants', function (Blueprint $t) {
            $t->json('options')->nullable()->after('product_id');
            $t->string('label', 200)->nullable()->after('options');
            $t->unique(['tenant_id', 'product_id', 'label'], 'product_variants_product_label_uq');
        });

        // Hasta ahora la variante copiaba el estado del producto. Desde acá, inactiva quiere decir
        // «quitada del producto»; el producto desactivado ya alcanza para que no se venda.
        DB::table('product_variants')->update(['status' => 'active']);
    }

    public function down(): void
    {
        Schema::table('product_variants', function (Blueprint $t) {
            $t->dropUnique('product_variants_product_label_uq');
            $t->dropColumn(['options', 'label']);
        });
        Schema::table('products', function (Blueprint $t) {
            $t->dropColumn('option_names');
        });
    }
};
