<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Ingreso con nombre de usuario o email (ADR 0010): el email pasa a ser opcional. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $t) {
            $t->string('username', 30)->nullable()->after('id')->unique('users_username_uq');
            $t->string('email', 254)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $t) {
            $t->dropUnique('users_username_uq');
            $t->dropColumn('username');
            $t->string('email', 254)->nullable(false)->change();
        });
    }
};
