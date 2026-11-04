<?php

namespace App\Services;

use App\Auth\Actor;
use App\Models\Customer;
use App\Models\CustomerMovement;
use App\Models\PaymentMethod;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Support\AppError;
use App\Support\Money;
use Brick\Math\BigDecimal;

/**
 * Cuenta corriente de clientes (ADR 0016). El saldo cambia solo dentro de la transacción de la
 * venta, el cobro, la devolución o la anulación que lo mueve, con el cliente bloqueado y un
 * movimiento de solo agregado. Saldo positivo: lo que debe; negativo: saldo a favor.
 */
class CustomerAccountService
{
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

    public function charge(Actor $actor, Customer $customer, Sale $sale, BigDecimal $amount): void
    {
        $this->move($actor, $customer, 'sale', $amount, ['sale_id' => $sale->id]);
    }

    /** Cobro de deuda: la venta de tipo account_payment que trajo la plata. */
    public function collect(Actor $actor, Customer $customer, Sale $sale, BigDecimal $amount): void
    {
        $this->move($actor, $customer, 'payment', $amount->negated(), ['sale_id' => $sale->id]);
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
    }

    /** Anulación: deshace lo que la venta o el cobro movió en la cuenta. */
    public function voidSale(Actor $actor, Sale $sale): void
    {
        if ($sale->customer_id === null) {
            return;
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
