<?php

namespace App\Services;

use App\Auth\Actor;
use App\Models\AccountTerm;
use App\Models\Customer;
use App\Models\CustomerMovement;
use App\Models\PaymentMethod;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Support\AppError;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * Cuenta corriente de clientes (ADR 0016). El saldo cambia solo dentro de la transacción de la
 * venta, el cobro, la devolución o la anulación que lo mueve, con el cliente bloqueado y un
 * movimiento de solo agregado. Saldo positivo: lo que debe; negativo: saldo a favor.
 *
 * Plazo a precio de contado (ADR 0029): lo que una venta deja a cuenta se debe a precio de
 * contado hasta el vencimiento (account_terms). Los pagos bajan primero lo que tiene plazo, del
 * que vence antes al que vence después. Si al vencer queda algo sin pagar, toda la venta pasa a
 * precio de lista: un movimiento «surcharge» suma la diferencia de lista que falta cobrar.
 */
class CustomerAccountService
{
    /** Días para pagar a precio de contado lo que queda a cuenta. 0: va siempre a precio de lista. */
    public const DEFAULT_TERM_DAYS = 7;

    public function __construct(private readonly AuditService $audit) {}

    /** Fecha de hoy en la Argentina, que es la que cuenta para los vencimientos. */
    public static function today(): string
    {
        return now('America/Buenos_Aires')->toDateString();
    }

    /** Medio interno con que se registra lo vendido a cuenta: se crea la primera vez que se usa. */
    public function method(): PaymentMethod
    {
        return PaymentMethod::where('kind', 'account')->first()
            ?? PaymentMethod::create(['name' => 'Cuenta corriente', 'kind' => 'account', 'requires_reference' => false, 'sort_order' => 97]);
    }

    /** Cliente activo de una venta; bloqueado si va a mover su saldo. */
    public function customer(string $id, bool $lock = false, string $path = 'customerId'): Customer
    {
        $customer = Customer::whereKey($id)->when($lock, fn ($q) => $q->lockForUpdate())->first();
        if (! $customer || $customer->status !== 'active') {
            throw AppError::validation([['path' => $path, 'message' => 'El cliente no existe o está desactivado']]);
        }

        return $customer;
    }

    /** Comprueba que el cliente pueda deber ese importe más. El saldo a favor se usa aunque no tenga crédito. */
    public function assertCredit(Customer $customer, BigDecimal $amount): void
    {
        $after = Money::of($customer->balance)->plus($amount);
        $limit = $customer->credit_limit === null ? BigDecimal::zero() : Money::of($customer->credit_limit);
        if ($after->isGreaterThan($limit)) {
            $message = $customer->credit_limit === null
                ? "{$customer->name} no tiene cuenta corriente habilitada. Se configura en la ficha del cliente con un límite de crédito."
                : "Supera el límite de cuenta corriente de {$customer->name}: debe ".Money::pesos($customer->balance).' y el límite es '.Money::pesos($customer->credit_limit).'.';
            throw AppError::validation([['path' => 'accountAmount', 'message' => $message]]);
        }
    }

    /**
     * Carga a cuenta. Con $term (venta a precio de contado con diferencia de lista), lo que queda
     * debiendo tiene plazo hasta $term['dueOn'] para pagarse a precio de contado.
     *
     * @param  array{dueOn: string, cashTotal: string, lateSurcharge: string}|null  $term
     */
    public function charge(Actor $actor, Customer $customer, Sale $sale, BigDecimal $amount, ?array $term = null): void
    {
        $credit = BigDecimal::max(BigDecimal::zero(), Money::of($customer->balance)->negated());
        $this->move($actor, $customer, 'sale', $amount, ['sale_id' => $sale->id]);
        // El saldo a favor que tenía ya pagó parte: el plazo corre solo por lo que queda debiendo.
        $owed = $amount->minus(BigDecimal::min($credit, $amount));
        if ($term !== null && $owed->isPositive()) {
            AccountTerm::create([
                'customer_id' => $customer->id, 'sale_id' => $sale->id, 'due_on' => $term['dueOn'], 'amount' => Money::round($owed), 'pending_amount' => Money::round($owed),
                'cash_total' => Money::round($term['cashTotal']), 'late_surcharge' => Money::round($term['lateSurcharge']), 'status' => 'open',
            ]);
        }
    }

    /** Cobro de deuda: la venta de tipo account_payment que trajo la plata. Baja primero lo que tiene plazo. */
    public function collect(Actor $actor, Customer $customer, Sale $sale, BigDecimal $amount): void
    {
        $this->move($actor, $customer, 'payment', $amount->negated(), ['sale_id' => $sale->id]);
        $left = $amount;
        $terms = AccountTerm::where('customer_id', $customer->id)->where('status', 'open')->orderBy('due_on')->orderBy('created_at')->lockForUpdate()->get();
        foreach ($terms as $term) {
            if (! $left->isPositive()) {
                break;
            }
            $take = BigDecimal::min($left, Money::of($term->pending_amount));
            $this->reduceTerm($term, $take);
            $left = $left->minus($take);
        }
    }

    /** Plazos abiertos de un cliente: cuánto debe a contado y desde cuándo pasa a lista. */
    public static function openTerms(string $customerId)
    {
        return AccountTerm::where('customer_id', $customerId)->where('status', 'open')->orderBy('due_on')->orderBy('created_at')->get();
    }

    /**
     * Aplica el recargo de lista a lo que venció sin pagarse. Se llama al leer o mover cuentas,
     * así no depende de un cron. Cada plazo vence una sola vez, con su fila bloqueada.
     */
    public function applyOverdue(Actor $actor, ?string $customerId = null): int
    {
        $due = AccountTerm::where('status', 'open')->where('due_on', '<', self::today())
            ->when($customerId, fn ($q) => $q->where('customer_id', $customerId))->orderBy('due_on')->limit(500)->pluck('id');
        $applied = 0;
        foreach ($due as $id) {
            $applied += DB::transaction(function () use ($actor, $id) {
                $term = AccountTerm::whereKey($id)->lockForUpdate()->first();
                if (! $term || $term->status !== 'open' || $term->due_on->toDateString() >= self::today()) {
                    return 0;
                }
                $customer = Customer::whereKey($term->customer_id)->lockForUpdate()->first();
                $pending = Money::round($term->pending_amount);
                $surcharge = Money::of($term->late_surcharge);
                $number = (int) Sale::whereKey($term->sale_id)->value('number');
                if ($surcharge->isPositive()) {
                    $this->move($actor, $customer, 'surcharge', $surcharge, [
                        'sale_id' => $term->sale_id, 'notes' => "Venció el {$term->due_on->format('d/m/Y')} el plazo de contado de la venta N° {$number}: pasa a precio de lista",
                    ]);
                }
                $term->forceFill(['status' => 'surcharged', 'pending_amount' => '0.00', 'surcharge_amount' => Money::round($surcharge)])->save();
                $this->audit->record([
                    'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
                    'action' => 'customer.term_surcharged', 'entityType' => 'customer', 'entityId' => $customer->id, 'before' => ['pending' => $pending],
                    'after' => ['saleNumber' => $number, 'dueOn' => $term->due_on->toDateString(), 'surcharge' => Money::round($surcharge), 'balance' => $customer->balance],
                    'ip' => $actor->ip, 'requestId' => $actor->requestId,
                ]);

                return 1;
            });
        }

        return $applied;
    }

    private function reduceTerm(AccountTerm $term, BigDecimal $amount): void
    {
        $pending = BigDecimal::max(BigDecimal::zero(), Money::of($term->pending_amount)->minus($amount));
        $term->forceFill(['pending_amount' => Money::round($pending), 'status' => $pending->isZero() ? 'paid' : 'open'])->save();
    }

    /** Lo que de esta venta se cargó a la cuenta y todavía no se devolvió. */
    public static function refundable(Sale $sale): BigDecimal
    {
        return BigDecimal::max(BigDecimal::zero(), Money::of((string) CustomerMovement::where('sale_id', $sale->id)->whereIn('kind', ['sale', 'return'])->sum('amount')));
    }

    /** Devolución de una venta a cuenta: lo devuelto baja la deuda, no sale de la caja. */
    public function refund(Actor $actor, Sale $sale, SaleReturn $saleReturn, BigDecimal $amount): void
    {
        $customer = Customer::whereKey($sale->customer_id)->lockForUpdate()->first();
        $this->move($actor, $customer, 'return', $amount->negated(), ['sale_id' => $sale->id, 'sale_return_id' => $saleReturn->id]);
        if ($term = AccountTerm::where('sale_id', $sale->id)->where('status', 'open')->lockForUpdate()->first()) {
            // Lo devuelto deja de estar en la venta: el recargo por vencimiento baja en proporción.
            $cash = Money::of($term->cash_total);
            $left = BigDecimal::max(BigDecimal::zero(), $cash->minus($amount));
            $late = $cash->isPositive() ? Money::round(Money::divide(Money::of($term->late_surcharge)->multipliedBy($left), $cash)) : '0.00';
            $term->forceFill(['cash_total' => Money::round($left), 'late_surcharge' => $late]);
            $this->reduceTerm($term, $amount);
        }
    }

    /** Anulación: deshace lo que la venta o el cobro movió en la cuenta. */
    public function voidSale(Actor $actor, Sale $sale): void
    {
        if ($sale->customer_id === null) {
            return;
        }
        foreach (AccountTerm::where('sale_id', $sale->id)->where('status', 'open')->lockForUpdate()->get() as $term) {
            $term->forceFill(['status' => 'voided', 'pending_amount' => '0.00'])->save();
        }
        $net = Money::of((string) CustomerMovement::where('sale_id', $sale->id)->sum('amount'));
        if ($net->isZero()) {
            return;
        }
        $customer = Customer::whereKey($sale->customer_id)->lockForUpdate()->first();
        $this->move($actor, $customer, 'void', $net->negated(), ['sale_id' => $sale->id]);
    }

    /** Saldo inicial o corrección, con motivo. */
    public function adjust(Actor $actor, Customer $customer, BigDecimal $amount, string $notes): void
    {
        $this->move($actor, $customer, 'adjustment', $amount, ['notes' => $notes]);
    }

    private function move(Actor $actor, Customer $customer, string $kind, BigDecimal $amount, array $extra): void
    {
        $balance = Money::of($customer->balance)->plus($amount);
        $customer->forceFill(['balance' => Money::round($balance)])->save();
        CustomerMovement::create([
            'customer_id' => $customer->id, 'kind' => $kind, 'amount' => Money::round($amount), 'balance_after' => Money::round($balance), 'user_id' => $actor->userId,
        ] + $extra);
    }
}
