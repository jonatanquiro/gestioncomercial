<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Catálogo de referencia: productos con código de barras tomados de datos abiertos (SEPA,
 * Precios Claros). Es común a todos los comercios y no es dato de ninguno: no lleva tenant_id.
 * Sirve para sugerir nombre, marca y presentación cuando un comercio carga un código que no
 * tiene. No guarda precios. Se llena con `php artisan catalogo:importar-sepa`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reference_products', function (Blueprint $t) {
            // GTIN sin ceros a la izquierda: el mismo producto leído como UPC-A o EAN-13 da la misma clave.
            $t->string('code', 14)->primary();
            $t->string('name', 160);
            $t->string('brand', 80)->nullable();
            $t->string('presentation', 40)->nullable();
            $t->string('source', 20);
            // En cuántas cadenas aparece: da una idea de qué tan común es.
            $t->unsignedInteger('seen_in')->default(1);
            $t->dateTime('updated_at', 6);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reference_products');
    }
};
