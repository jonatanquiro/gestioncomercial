<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settlements', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('payment_method_id');
            $t->string('provider', 80);
            $t->date('from_date');
            $t->date('to_date');
            $t->string('status', 20)->default('open');
            $t->uuid('created_by');
            $t->uuid('closed_by')->nullable();
            $t->dateTime('closed_at', 6)->nullable();
            $t->text('closing_notes')->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id']);
            $t->foreign(['tenant_id', 'payment_method_id'])->references(['tenant_id', 'id'])->on('payment_methods');
            $t->foreign('created_by')->references('id')->on('users');
            $t->foreign('closed_by')->references('id')->on('users');
        });
        Schema::create('settlement_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('settlement_id');
            $t->uuid('sale_payment_id')->nullable();
            $t->string('reference', 100)->nullable();
            $t->decimal('expected', 14, 2)->nullable();
            $t->decimal('gross', 14, 2)->nullable();
            $t->decimal('fees', 14, 2)->nullable();
            $t->decimal('net', 14, 2)->nullable();
            $t->string('external_id', 100)->nullable();
            $t->date('credited_on')->nullable();
            $t->string('status', 20)->default('pending');
            $t->string('source', 20)->default('sale');
            $t->text('notes')->nullable();
            $t->uuid('reviewed_by')->nullable();
            $t->dateTime('reviewed_at', 6)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id']);
            $t->unique(['tenant_id', 'sale_payment_id'], 'settlement_items_payment_uq');
            $t->unique(['settlement_id', 'external_id'], 'settlement_items_external_uq');
            $t->foreign(['tenant_id', 'settlement_id'])->references(['tenant_id', 'id'])->on('settlements');
            $t->foreign(['tenant_id', 'sale_payment_id'])->references(['tenant_id', 'id'])->on('sale_payments');
            $t->foreign('reviewed_by')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('settlement_items');
        Schema::dropIfExists('settlements');
    }
};
