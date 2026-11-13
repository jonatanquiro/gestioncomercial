<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Notas de crédito ARCA (ADR 0017). Un comprobante puede ser la factura de la venta o una nota
 * de crédito asociada a ella: una por cada devolución, o una por la anulación de la venta.
 * document_key ocupa el lugar de la unicidad anterior (una factura por venta y ambiente).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fiscal_invoices', function (Blueprint $t) {
            $t->string('kind', 20)->default('invoice')->after('sale_id');
            $t->uuid('sale_return_id')->nullable()->after('kind');
            $t->uuid('associated_invoice_id')->nullable()->after('sale_return_id');
            $t->string('document_key', 40)->storedAs("IF(kind = 'invoice', 'invoice', IFNULL(sale_return_id, 'void'))")->after('associated_invoice_id');
            $t->foreign(['tenant_id', 'sale_return_id'], 'fiscal_invoices_return_fk')->references(['tenant_id', 'id'])->on('sale_returns');
            $t->foreign(['tenant_id', 'associated_invoice_id'], 'fiscal_invoices_associated_fk')->references(['tenant_id', 'id'])->on('fiscal_invoices');
        });
        // Primero el índice nuevo: la FK de la venta usa el viejo y no se puede quedar sin índice.
        Schema::table('fiscal_invoices', fn (Blueprint $t) => $t->unique(['tenant_id', 'sale_id', 'environment', 'document_key'], 'fiscal_invoice_document_uq'));
        Schema::table('fiscal_invoices', fn (Blueprint $t) => $t->dropUnique('fiscal_invoice_sale_uq'));
    }

    public function down(): void
    {
        Schema::table('fiscal_invoices', fn (Blueprint $t) => $t->unique(['tenant_id', 'sale_id', 'environment'], 'fiscal_invoice_sale_uq'));
        Schema::table('fiscal_invoices', function (Blueprint $t) {
            $t->dropUnique('fiscal_invoice_document_uq');
            $t->dropForeign('fiscal_invoices_return_fk');
            $t->dropForeign('fiscal_invoices_associated_fk');
            $t->dropColumn(['document_key', 'associated_invoice_id', 'sale_return_id', 'kind']);
        });
    }
};
