<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fiscal_settings', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->string('environment', 20);
            $t->string('cuit', 11);
            $t->unsignedInteger('point_of_sale')->default(1);
            $t->string('credential_mode', 20)->default('own');
            $t->json('issuer_metadata')->nullable();
            $t->text('certificate_enc')->nullable();
            $t->text('private_key_enc')->nullable();
            $t->text('csr')->nullable();
            $t->text('ticket_enc')->nullable();
            $t->dateTime('ticket_expires_at', 6)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id']);
            $t->unique(['tenant_id', 'environment']);
            $t->foreign('tenant_id')->references('id')->on('tenants');
        });
        Schema::create('fiscal_invoices', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('sale_id');
            $t->string('environment', 20);
            $t->string('cuit', 11);
            $t->unsignedInteger('point_of_sale');
            $t->unsignedSmallInteger('voucher_type');
            $t->unsignedBigInteger('number')->nullable();
            $t->string('status', 20)->default('pending');
            $t->unsignedBigInteger('active_number')->nullable()->storedAs("IF(status = 'rejected', NULL, number)");
            $t->json('payload');
            $t->string('cae', 20)->nullable();
            $t->string('cae_expires_on', 10)->nullable();
            $t->text('message')->nullable();
            $t->uuid('created_by');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id']);
            $t->unique(['tenant_id', 'sale_id', 'environment'], 'fiscal_invoice_sale_uq');
            $t->unique(['tenant_id', 'environment', 'point_of_sale', 'voucher_type', 'active_number'], 'fiscal_invoice_number_uq');
            $t->foreign(['tenant_id', 'sale_id'])->references(['tenant_id', 'id'])->on('sales');
            $t->foreign('created_by')->references('id')->on('users');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fiscal_invoices');
        Schema::dropIfExists('fiscal_settings');
    }
};
