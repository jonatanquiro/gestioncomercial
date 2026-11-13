<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Pago mixto proporcional y plazo a precio de contado en cuenta corriente (ADR 0029).
 * - Lo pagado con medios de contado va a precio de contado; lo pagado con otros medios lleva el
 *   recargo de lista solo sobre la parte que cubre (sales.surcharge_total, repartido por línea).
 * - Lo que queda a cuenta corriente se debe a precio de contado hasta el vencimiento. Si al
 *   vencer falta pagar algo, toda la venta pasa a precio de lista: se suma la diferencia entre
 *   lista y contado que todavía no se cobró (account_terms).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $t) {
            $t->decimal('surcharge_total', 14, 2)->default(0)->after('discount_total');
            // Total de la venta toda a precio de lista: el valor «después del vencimiento».
            $t->decimal('list_total', 14, 2)->nullable()->after('total');
        });
        Schema::table('sale_lines', function (Blueprint $t) {
            $t->decimal('surcharge_amount', 14, 2)->default(0)->after('promotion_discount');
        });

        Schema::create('account_terms', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('tenant_id');
            $t->uuid('customer_id');
            $t->uuid('sale_id');
            // Último día para pagar a precio de contado.
            $t->date('due_on');
            // Lo cargado a cuenta y lo que falta pagar de eso, a precio de contado.
            $t->decimal('amount', 14, 2);
            $t->decimal('pending_amount', 14, 2);
            // Mercadería de la venta a precio de contado (baja con las devoluciones) y lo que se
            // recarga si vence con saldo: lista − contado − el recargo que ya se cobró con tarjeta.
            $t->decimal('cash_total', 14, 2);
            $t->decimal('late_surcharge', 14, 2);
            // open: corre el plazo · paid: se pagó a tiempo · surcharged: venció y se recargó · voided: venta anulada.
            $t->string('status', 12)->default('open');
            $t->decimal('surcharge_amount', 14, 2)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
            $t->unique(['tenant_id', 'id'], 'account_terms_tenant_id_uq');
            $t->unique(['tenant_id', 'sale_id'], 'account_terms_sale_uq');
            $t->index(['tenant_id', 'status', 'due_on'], 'account_terms_due_idx');
            $t->index(['tenant_id', 'customer_id', 'status'], 'account_terms_customer_idx');
            $t->foreign('tenant_id')->references('id')->on('tenants');
            $t->foreign(['tenant_id', 'customer_id'], 'account_terms_customer_fk')->references(['tenant_id', 'id'])->on('customers');
            $t->foreign(['tenant_id', 'sale_id'], 'account_terms_sale_fk')->references(['tenant_id', 'id'])->on('sales');
        });
        DB::statement("ALTER TABLE account_terms ADD CONSTRAINT account_terms_values_ck CHECK (
            status IN ('open', 'paid', 'surcharged', 'voided') AND amount > 0 AND pending_amount >= 0 AND pending_amount <= amount
            AND cash_total >= 0 AND late_surcharge >= 0)");

        DB::statement('ALTER TABLE customer_movements DROP CONSTRAINT customer_movements_values_ck');
        DB::statement("ALTER TABLE customer_movements ADD CONSTRAINT customer_movements_values_ck CHECK (kind IN ('sale', 'payment', 'return', 'void', 'adjustment', 'surcharge') AND amount <> 0)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE customer_movements DROP CONSTRAINT customer_movements_values_ck');
        DB::statement("ALTER TABLE customer_movements ADD CONSTRAINT customer_movements_values_ck CHECK (kind IN ('sale', 'payment', 'return', 'void', 'adjustment') AND amount <> 0)");
        Schema::dropIfExists('account_terms');
        Schema::table('sale_lines', fn (Blueprint $t) => $t->dropColumn('surcharge_amount'));
        Schema::table('sales', fn (Blueprint $t) => $t->dropColumn(['surcharge_total', 'list_total']));
    }
};
