<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $t) {
            $t->json('appearance')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('tenants', fn (Blueprint $t) => $t->dropColumn('appearance'));
    }
};
