<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Talles y colores en todos los planes (ADR 0025): para ropa y calzado son indispensables. Se
 * suma la función a los planes que ya existen; después se puede quitar desde el panel.
 */
return new class extends Migration
{
    public function up(): void
    {
        $without = DB::table('plans')->whereNotIn('id', DB::table('plan_features')->where('feature', 'variants')->select('plan_id'))->pluck('id');
        DB::table('plan_features')->insert($without->map(fn ($id) => ['plan_id' => $id, 'feature' => 'variants'])->all());
    }

    public function down(): void
    {
        // No se revierte: no se sabe qué planes la tenían antes.
    }
};
