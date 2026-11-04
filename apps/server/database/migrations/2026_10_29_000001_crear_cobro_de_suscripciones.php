<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Cobro de suscripciones con Mercado Pago y avisos de vencimiento (ADR 0012). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('subscriptions', function (Blueprint $t) {
            // Licencia sin vencimiento: el comercio no paga ni se pausa.
            $t->boolean('free_forever')->default(false)->after('current_period_end');
            // Último aviso por correo: a qué vencimiento correspondía y en qué etapa (d7, d3, d1, due, paused).
            $t->dateTime('notice_due_at', 6)->nullable()->after('free_forever');
            $t->string('notice_stage', 10)->nullable()->after('notice_due_at');
        });

        Schema::create('subscription_payments', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('plan_id');
            $t->unsignedTinyInteger('months');
            $t->decimal('amount', 14, 2);
            $t->string('currency', 3)->default('ARS');
            $t->string('method', 20);
            $t->string('status', 20)->default('pending');
            $t->string('mp_preference_id', 100)->nullable();
            $t->string('mp_payment_id', 40)->nullable();
            $t->dateTime('period_from', 6)->nullable();
            $t->dateTime('period_to', 6)->nullable();
            $t->uuid('created_by')->nullable();
            $t->string('notes', 300)->nullable();
            $t->json('details')->nullable();
            $t->dateTime('checked_at', 6)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id']);
            $t->unique('mp_payment_id', 'subscription_payments_mp_uq');
            $t->index(['status', 'created_at'], 'subscription_payments_status_idx');
            $t->foreign('tenant_id')->references('id')->on('tenants');
            $t->foreign('plan_id')->references('id')->on('plans');
            $t->foreign('created_by')->references('id')->on('users');
        });
        DB::statement("ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_status_ck CHECK (status IN ('pending', 'approved', 'rejected', 'refunded', 'error'))");
        DB::statement("ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_method_ck CHECK (method IN ('mercadopago', 'manual'))");
        DB::statement('ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_months_ck CHECK (months BETWEEN 1 AND 36)');
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_payments');
        Schema::table('subscriptions', function (Blueprint $t) {
            $t->dropColumn(['free_forever', 'notice_due_at', 'notice_stage']);
        });
    }
};
