<?php

namespace App\Services;

use App\Auth\Actor;
use App\Models\Supplier;
use App\Models\SupplierMovement;
use App\Support\AppError;
use App\Support\Money;
use Brick\Math\BigDecimal;

/**
 * Cuenta corriente con proveedores (ADR 0018). El saldo cambia dentro de la transacción de la
 * compra, el pago o el ajuste, con el proveedor bloqueado y un movimiento de solo agregado.
 * Saldo positivo: lo que se le debe; negativo: pagos adelantados.
 */
class SupplierAccountService
{
    public function __construct(private readonly CashService $cash) {}

    /** La compra deja un importe a pagar. */
    public function purchase(Actor $actor, Supplier $supplier, string $purchaseId, BigDecimal $amount): void
    {
        $this->move($actor, $supplier, 'purchase', $amount, ['purchase_id' => $purchaseId]);
    }

    /**
     * Pago al proveedor. En efectivo sale de una caja abierta, con control de que alcance.
     *
     * @param  array{clientUuid: string, amount: string, method: string, registerId?: ?string, reference?: ?string, notes?: ?string}  $input
     */
    public function pay(Actor $actor, Supplier $supplier, array $input): SupplierMovement
    {
        $amount = BigDecimal::of(Money::round($input['amount']));
        $shiftId = null;
        if ($input['method'] === 'cash') {
            $register = $this->cash->register($actor, $input['registerId'] ?? '');
            $shift = $this->cash->lockOpenShift($register->id);
            if ($amount->isGreaterThan($this->cash->expectedCash($shift))) {
                throw AppError::conflict('CASH_INSUFFICIENT', 'No hay '.Money::pesos($amount).' en efectivo en '.$register->name.'. Elegí otro medio o registrá un ingreso de efectivo.');
            }
            $this->cash->addMovement($actor, $shift, 'supplier_payment', $amount->negated(), ['reason' => "Pago a {$supplier->name}", 'source_type' => 'supplier', 'source_id' => $supplier->id]);
            $shiftId = $shift->id;
        }

        return $this->move($actor, $supplier, 'payment', $amount->negated(), [
            'method' => $input['method'], 'shift_id' => $shiftId, 'reference' => trim((string) ($input['reference'] ?? '')) ?: null,
            'notes' => trim((string) ($input['notes'] ?? '')) ?: null, 'client_uuid' => $input['clientUuid'],
        ]);
    }

    public function adjust(Actor $actor, Supplier $supplier, BigDecimal $amount, string $notes): void
    {
        $this->move($actor, $supplier, 'adjustment', $amount, ['notes' => $notes]);
    }

    private function move(Actor $actor, Supplier $supplier, string $kind, BigDecimal $amount, array $extra): SupplierMovement
    {
        $balance = Money::of($supplier->balance ?? '0')->plus($amount);
        $supplier->forceFill(['balance' => Money::round($balance)])->save();

        return SupplierMovement::create([
            'supplier_id' => $supplier->id, 'kind' => $kind, 'amount' => Money::round($amount), 'balance_after' => Money::round($balance), 'user_id' => $actor->userId,
        ] + $extra);
    }
}
