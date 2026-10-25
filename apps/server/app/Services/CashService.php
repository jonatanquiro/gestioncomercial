<?php

namespace App\Services;

use App\Auth\Actor;
use App\Models\CashCount;
use App\Models\CashMovement;
use App\Models\CashShift;
use App\Models\PaymentMethod;
use App\Models\Register;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Support\AppError;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Turnos de caja (sección 9 del diseño): apertura con fondo inicial, retiros e ingresos,
 * arqueos parciales y cierre ciego. El efectivo esperado es el fondo más la suma de los
 * movimientos de efectivo del turno, que se guardan con signo (+ entra, − sale).
 */
class CashService
{
    public function __construct(private readonly AuditService $audit) {}

    /** Caja activa de una sucursal a la que el actor tiene acceso. */
    public function register(Actor $actor, string $registerId): Register
    {
        $register = Register::find($registerId) ?? throw AppError::notFound('Caja');
        $this->assertBranch($actor, $register->branch_id);
        if ($register->status !== 'active') {
            throw AppError::conflict('REGISTER_INACTIVE', "{$register->name} está desactivada");
        }

        return $register;
    }

    public function assertBranch(Actor $actor, string $branchId): void
    {
        if (! in_array($branchId, $actor->branchIds, true) && ! $actor->can('branches.manage')) {
            throw AppError::forbidden();
        }
    }

    public function open(Actor $actor, string $registerId, string $openingFloat): CashShift
    {
        $register = $this->register($actor, $registerId);
        try {
            return DB::transaction(function () use ($actor, $register, $openingFloat) {
                $shift = CashShift::create([
                    'register_id' => $register->id,
                    'status' => 'open',
                    'opening_float' => Money::round($openingFloat),
                    'opened_by' => $actor->userId,
                    'opened_at' => Carbon::now(),
                ]);
                $this->record($actor, 'cash.opened', $shift->id, ['register' => $register->name, 'openingFloat' => Money::round($openingFloat)]);

                return $shift;
            });
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('SHIFT_ALREADY_OPEN', "{$register->name} ya tiene un turno abierto");
        }
    }

    /** Turno abierto de la caja, bloqueado hasta el fin de la transacción. */
    public function lockOpenShift(string $registerId): CashShift
    {
        return CashShift::where('register_id', $registerId)->where('status', 'open')->lockForUpdate()->first()
            ?? throw AppError::conflict('SHIFT_NOT_OPEN', 'La caja no está abierta: abrí un turno para operar');
    }

    public function lockShift(string $shiftId): CashShift
    {
        $shift = CashShift::whereKey($shiftId)->lockForUpdate()->first() ?? throw AppError::notFound('Turno');
        if ($shift->status !== 'open') {
            throw AppError::conflict('SHIFT_CLOSED', 'El turno ya está cerrado');
        }

        return $shift;
    }

    public function expectedCash(CashShift $shift): BigDecimal
    {
        $moved = CashMovement::where('shift_id', $shift->id)->sum('amount');

        return Money::of($shift->opening_float)->plus(Money::round((string) $moved));
    }

    /** Agrega un movimiento de efectivo con signo. Se llama dentro de la transacción. */
    public function addMovement(Actor $actor, CashShift $shift, string $type, BigDecimal $signedAmount, array $extra = []): CashMovement
    {
        return CashMovement::create([
            'shift_id' => $shift->id,
            'type' => $type,
            'amount' => Money::round($signedAmount),
            'user_id' => $actor->userId,
            'occurred_at' => Carbon::now(),
        ] + $extra);
    }

    /** Retiro (sale efectivo) o ingreso (entra efectivo) con motivo. */
    public function move(Actor $actor, string $shiftId, string $type, string $amount, string $reason): CashMovement
    {
        $permission = $type === 'withdrawal' ? 'cash.withdraw' : 'cash.deposit';
        if (! $actor->can($permission)) {
            throw AppError::forbidden($permission);
        }

        return DB::transaction(function () use ($actor, $shiftId, $type, $amount, $reason) {
            $shift = $this->lockShift($shiftId);
            $this->assertBranch($actor, Register::find($shift->register_id)->branch_id);
            $value = Money::of(Money::round($amount));
            if ($type === 'withdrawal' && $value->isGreaterThan($this->expectedCash($shift))) {
                throw AppError::conflict('CASH_INSUFFICIENT', 'No hay tanto efectivo en la caja');
            }
            $movement = $this->addMovement($actor, $shift, $type, $type === 'withdrawal' ? $value->negated() : $value, ['reason' => $reason]);
            $this->record($actor, $type === 'withdrawal' ? 'cash.withdrawal' : 'cash.deposit', $shift->id, ['amount' => (string) $value, 'reason' => $reason]);

            return $movement;
        });
    }

    /** Arqueo parcial: se cuenta el efectivo sin cerrar el turno. */
    public function count(Actor $actor, string $shiftId, string $counted): CashCount
    {
        return DB::transaction(function () use ($actor, $shiftId, $counted) {
            $shift = $this->lockShift($shiftId);
            $this->assertBranch($actor, Register::find($shift->register_id)->branch_id);
            $expected = $this->expectedCash($shift);
            $count = CashCount::create([
                'shift_id' => $shift->id, 'kind' => 'partial', 'counted' => Money::round($counted), 'expected' => Money::round($expected),
                'counted_by' => $actor->userId, 'counted_at' => Carbon::now(),
            ]);
            $this->record($actor, 'cash.counted', $shift->id, ['counted' => Money::round($counted), 'expected' => Money::round($expected)]);

            return $count;
        });
    }

    /** Cierre ciego: el cajero informa lo contado; el esperado y la diferencia se calculan acá. */
    public function close(Actor $actor, string $shiftId, string $counted, ?string $notes): CashShift
    {
        return DB::transaction(function () use ($actor, $shiftId, $counted, $notes) {
            $shift = $this->lockShift($shiftId);
            $this->assertBranch($actor, Register::find($shift->register_id)->branch_id);
            $expected = $this->expectedCash($shift);
            $countedValue = Money::of(Money::round($counted));
            $now = Carbon::now();
            CashCount::create([
                'shift_id' => $shift->id, 'kind' => 'closing', 'counted' => (string) $countedValue, 'expected' => Money::round($expected),
                'counted_by' => $actor->userId, 'counted_at' => $now,
            ]);
            $totals = $this->totalsByMethod($shift->id);
            $shift->forceFill([
                'status' => 'closed',
                'closed_by' => $actor->userId,
                'closed_at' => $now,
                'expected_cash' => Money::round($expected),
                'counted_cash' => (string) $countedValue,
                'difference' => Money::round($countedValue->minus($expected)),
                'totals_by_method' => $totals,
                'closing_notes' => $notes,
            ])->save();
            $this->record($actor, 'cash.closed', $shift->id, [
                'expected' => $shift->expected_cash, 'counted' => $shift->counted_cash, 'difference' => $shift->difference, 'notes' => $notes,
            ]);

            return $shift;
        });
    }

    /**
     * Cobrado por medio de pago en el turno: ventas confirmadas menos devoluciones.
     *
     * @return list<array{paymentMethodId: string, name: string, kind: string, sales: string, refunds: string, net: string}>
     */
    public function totalsByMethod(string $shiftId): array
    {
        $sales = SalePayment::whereIn('sale_id', Sale::where('shift_id', $shiftId)->where('status', 'confirmed')->select('id'))
            ->groupBy('payment_method_id')->selectRaw('payment_method_id, SUM(amount) AS total')->pluck('total', 'payment_method_id');
        $refunds = SaleReturn::where('shift_id', $shiftId)
            ->groupBy('payment_method_id')->selectRaw('payment_method_id, SUM(total) AS total')->pluck('total', 'payment_method_id');
        $ids = $sales->keys()->merge($refunds->keys())->unique();
        $methods = PaymentMethod::whereIn('id', $ids)->orderBy('sort_order')->orderBy('name')->get();

        return $methods->map(fn (PaymentMethod $m) => [
            'paymentMethodId' => $m->id,
            'name' => $m->name,
            'kind' => $m->kind,
            'sales' => Money::round((string) ($sales[$m->id] ?? '0')),
            'refunds' => Money::round((string) ($refunds[$m->id] ?? '0')),
            'net' => Money::round(Money::of((string) ($sales[$m->id] ?? '0'))->minus((string) ($refunds[$m->id] ?? '0'))),
        ])->values()->all();
    }

    private function record(Actor $actor, string $action, string $shiftId, array $after): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId,
            'actorType' => 'user',
            'actorId' => $actor->userId,
            'actorName' => $actor->userName,
            'action' => $action,
            'entityType' => 'cash_shift',
            'entityId' => $shiftId,
            'after' => $after,
            'ip' => $actor->ip,
            'requestId' => $actor->requestId,
        ]);
    }
}
