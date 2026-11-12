<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * El mismo dueño puede usar su CUIT en varios comercios (ADR 0025). La regla ya no es un índice
 * único: la controla TenantCuitGuard, que deja repetir el CUIT solo entre comercios del mismo
 * dueño.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $t) {
            $t->dropUnique('tenants_cuit_active_uq');
            $t->index('cuit', 'tenants_cuit_idx');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $t) {
            $t->dropIndex('tenants_cuit_idx');
            $t->unique(['cuit', 'not_cancelled'], 'tenants_cuit_active_uq');
        });
    }
};
