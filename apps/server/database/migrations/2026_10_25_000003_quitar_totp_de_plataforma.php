<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** El panel de plataforma entra solo con email y contraseña (docs/adr/0007). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('platform_users', function (Blueprint $t) {
            $t->dropColumn('totp_secret_enc');
        });
    }

    public function down(): void
    {
        Schema::table('platform_users', function (Blueprint $t) {
            $t->text('totp_secret_enc')->nullable()->after('password_hash');
        });
    }
};
