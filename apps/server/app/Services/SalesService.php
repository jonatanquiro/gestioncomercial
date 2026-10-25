<?php

namespace App\Services;

use App\Auth\Actor;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Register;
use App\Models\Sale;
use App\Models\SaleLine;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\SaleReturnLine;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Support\AppError;
use App\Support\Money;
use App\Support\Pricing;
use Brick\Math\BigDecimal;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Ventas del punto de venta (sección 7 del diseño). Una venta se confirma entera o no se
 * confirma: venta, líneas, pagos, stock y caja van en una sola transacción. El mismo
 * clientUuid devuelve la venta ya registrada, aunque lleguen varios pedidos a la vez.
 *
 * Las autorizaciones con PIN se resuelven antes de abrir la transacción: así los intentos
 * fallidos cuentan para el límite aunque la operación no se haga.
 */
class SalesService
{
    public const DEFAULT_DISCOUNT_LIMIT = '10';

    public function __construct(
        private readonly CashService $cash,
        private readonly StockService $stock,
        private readonly SalesSetup $setup,
        private readonly PinAuthorization $pins,
        private readonly AuditService $audit,
    ) {}

    /**
     * @param  array{clientUuid: string, registerId: string, lines: list<array{variantId: string, quantity: string, discountPercent?: ?string}>, payments: list<array{paymentMethodId: string, amount: string, reference?: ?string}>, expectedTotal: string, authorization?: ?array}  $input
     * @return array{sale: Sale, created: bool}
     */
    public function create(Actor $actor, array $input): array
    {
        if ($sale = Sale::where('client_uuid', $input['clientUuid'])->first()) {
            return ['sale' => $sale, 'created' => false];
        }
        $register = $this->cash->register($actor, $input['registerId']);
        $discountAuthorizedBy = $this->authorizeDiscount($actor, $input);

        try {
            $sale = DB::transaction(fn () => $this->confirm($actor, $register, $input, $discountAuthorizedBy));
        } catch (UniqueConstraintViolationException $e) {
            // Otro pedido con el mismo clientUuid ganó la carrera: se devuelve esa venta.
            $sale = Sale::where('client_uuid', $input['clientUuid'])->first();
            if ($sale) {
                return ['sale' => $sale, 'created' => false];
            }
            throw $e;
        }

        return ['sale' => $sale, 'created' => true];
    }

    private function authorizeDiscount(Actor $actor, array $input): ?string
    {
        $max = BigDecimal::zero();
        foreach ($input['lines'] as $line) {
            $max = BigDecimal::max($max, BigDecimal::of($line['discountPercent'] ?? '0'));
        }
        if ($max->isZero()) {
            return null;
        }
        $limit = (string) (Tenant::find($actor->tenantId)->settings['discountLimitPercent'] ?? self::DEFAULT_DISCOUNT_LIMIT);
        if ($max->isLessThanOrEqualTo($limit) && $actor->can('sales.discount')) {
            return null;
        }

        return $this->pins->require($actor, 'sales.discount_unlimited', $input['authorization'] ?? null);
    }

    private function confirm(Actor $actor, Register $register, array $input, ?string $discountAuthorizedBy): Sale
    {
        $shift = $this->cash->lockOpenShift($register->id);
        $warehouse = Warehouse::where('branch_id', $register->branch_id)->where('is_default', true)->first()
            ?? throw AppError::notFound('Depósito');

        // Precios y datos vigentes del catálogo: lo que diga el pedido no cuenta.
        $variants = ProductVariant::whereIn('id', array_column($input['lines'], 'variantId'))->get()->keyBy('id');
        $products = Product::whereIn('id', $variants->pluck('product_id'))->get()->keyBy('id');
        $lines = [];
        $subtotal = BigDecimal::zero();
        $discountTotal = BigDecimal::zero();
        $total = BigDecimal::zero();
        foreach ($input['lines'] as $i => $line) {
            $variant = $variants[$line['variantId']] ?? throw AppError::validation([['path' => "lines.{$i}.variantId", 'message' => 'El artículo no existe']]);
            $product = $products[$variant->product_id];
            if ($product->status !== 'active' || $variant->status !== 'active') {
                throw new AppError(409, 'PRODUCT_INACTIVE', "{$product->name} está desactivado: no se puede vender", ['variantId' => $variant->id]);
            }
            if ($product->sale_mode === 'unit' && BigDecimal::of($line['quantity'])->hasNonZeroFractionalPart()) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => "{$product->name} se vende por unidad: la cantidad tiene que ser entera"]]);
            }
            $quantity = Money::quantity($line['quantity']);
            $discountPercent = Money::round($line['discountPercent'] ?? '0');
            $amounts = Pricing::saleLine($quantity, $variant->price, $discountPercent);
            $lines[] = compact('variant', 'product', 'quantity', 'discountPercent', 'amounts');
            $subtotal = $subtotal->plus($amounts['gross']);
            $discountTotal = $discountTotal->plus($amounts['discount']);
            $total = $total->plus($amounts['total']);
        }
        if (! $total->isEqualTo($input['expectedTotal'])) {
            throw new AppError(409, 'PRICE_CHANGED', 'Cambió el precio de algún artículo: revisá el total antes de cobrar', [
                'total' => Money::round($total),
                'prices' => array_map(fn ($l) => ['variantId' => $l['variant']->id, 'unitPrice' => Money::round($l['variant']->price)], $lines),
            ]);
        }

        [$payments, $change] = $this->payments($input['payments'], $total);

        $sale = Sale::create([
            'branch_id' => $register->branch_id,
            'register_id' => $register->id,
            'shift_id' => $shift->id,
            'warehouse_id' => $warehouse->id,
            'number' => $this->setup->nextNumber($register->branch_id, 'sale'),
            'client_uuid' => $input['clientUuid'],
            'status' => 'confirmed',
            'cashier_id' => $actor->userId,
            'subtotal' => Money::round($subtotal),
            'discount_total' => Money::round($discountTotal),
            'total' => Money::round($total),
            'change_given' => Money::round($change),
            'discount_authorized_by' => $discountAuthorizedBy,
            'confirmed_at' => Carbon::now(),
        ]);

        $stockLines = [];
        foreach ($lines as $n => $l) {
            $saleLine = SaleLine::create([
                'sale_id' => $sale->id,
                'line_no' => $n + 1,
                'variant_id' => $l['variant']->id,
                'description' => $l['product']->name,
                'sale_mode' => $l['product']->sale_mode,
                'quantity' => $l['quantity'],
                'unit_price' => Money::round($l['variant']->price),
                'unit_cost' => $l['variant']->cost,
                'discount_percent' => $l['discountPercent'],
                'discount_amount' => $l['amounts']['discount'],
                'vat_rate' => $l['product']->vat_rate,
                'line_total' => $l['amounts']['total'],
            ]);
            if ($l['product']->track_stock) {
                $stockLines[] = [
                    'warehouseId' => $warehouse->id, 'variantId' => $l['variant']->id, 'type' => 'sale_out',
                    'quantity' => Money::quantity(BigDecimal::of($l['quantity'])->negated()), 'sourceLineId' => $saleLine->id, 'unitCost' => $l['variant']->cost,
                ];
            }
        }
        $this->stock->apply($stockLines, ['sourceType' => 'sale', 'sourceId' => $sale->id, 'reason' => "Venta {$sale->number}", 'userId' => $actor->userId]);

        $cash = BigDecimal::zero();
        foreach ($payments as $p) {
            SalePayment::create([
                'sale_id' => $sale->id,
                'payment_method_id' => $p['method']->id,
                'kind' => $p['method']->kind,
                'amount' => Money::round($p['amount']),
                'status' => $p['method']->kind === 'cash' ? 'cash' : 'confirmed',
                'reference' => $p['reference'],
                'confirmed_by' => $p['method']->kind === 'cash' ? null : $actor->userId,
            ]);
            if ($p['method']->kind === 'cash') {
                $cash = $cash->plus($p['amount']);
            }
        }
        if (! $cash->isZero()) {
            $this->cash->addMovement($actor, $shift, 'sale', $cash, ['reason' => "Venta N° {$sale->number}", 'source_type' => 'sale', 'source_id' => $sale->id]);
        }

        $this->record($actor, 'sale.created', $sale->id, [
            'number' => $sale->number, 'total' => $sale->total, 'discountTotal' => $sale->discount_total,
            'discountAuthorizedBy' => $discountAuthorizedBy, 'lines' => count($lines),
        ]);

        return $sale;
    }

    /**
     * Valida los pagos contra el total. El vuelto sale solo del efectivo; lo que se registra
     * de cada pago en efectivo ya tiene el vuelto descontado, así la suma de los pagos
     * registrados es siempre igual al total de la venta.
     *
     * @return array{0: list<array{method: PaymentMethod, amount: BigDecimal, reference: ?string}>, 1: BigDecimal}
     */
    private function payments(array $input, BigDecimal $total): array
    {
        $methods = PaymentMethod::whereIn('id', array_column($input, 'paymentMethodId'))->get()->keyBy('id');
        $payments = [];
        $paid = BigDecimal::zero();
        $nonCash = BigDecimal::zero();
        foreach ($input as $i => $p) {
            $method = $methods[$p['paymentMethodId']] ?? null;
            if (! $method || ! $method->active) {
                throw AppError::validation([['path' => "payments.{$i}.paymentMethodId", 'message' => 'Medio de pago inexistente o desactivado']]);
            }
            $reference = trim((string) ($p['reference'] ?? '')) ?: null;
            if ($method->requires_reference && $reference === null) {
                throw AppError::validation([['path' => "payments.{$i}.reference", 'message' => "Cargá el número de operación de {$method->name}"]]);
            }
            $amount = BigDecimal::of(Money::round($p['amount']));
            $payments[] = ['method' => $method, 'amount' => $amount, 'reference' => $reference];
            $paid = $paid->plus($amount);
            if ($method->kind !== 'cash') {
                $nonCash = $nonCash->plus($amount);
            }
        }
        if ($paid->isLessThan($total)) {
            throw AppError::validation([['path' => 'payments', 'message' => 'Falta cobrar '.Money::round($total->minus($paid))]]);
        }
        if ($nonCash->isGreaterThan($total)) {
            throw AppError::validation([['path' => 'payments', 'message' => 'Los pagos que no son en efectivo no pueden superar el total: no se da vuelto con tarjeta ni transferencia']]);
        }
        $change = $paid->minus($total);
        // Descuenta el vuelto de los pagos en efectivo, empezando por el último.
        $left = $change;
        for ($i = count($payments) - 1; $i >= 0 && $left->isPositive(); $i--) {
            if ($payments[$i]['method']->kind !== 'cash') {
                continue;
            }
            $take = BigDecimal::min($left, $payments[$i]['amount']);
            $payments[$i]['amount'] = $payments[$i]['amount']->minus($take);
            $left = $left->minus($take);
        }

        return [array_values(array_filter($payments, fn ($p) => $p['amount']->isPositive())), $change];
    }

    /** Anulación: solo en el turno abierto en que se hizo y si no tiene devoluciones. */
    public function void(Actor $actor, string $saleId, string $reason, ?array $authorization): Sale
    {
        $sale = Sale::find($saleId) ?? throw AppError::notFound('Venta');
        $this->cash->assertBranch($actor, $sale->branch_id);
        $authorizedBy = $this->pins->require($actor, 'sales.void', $authorization);

        return DB::transaction(function () use ($actor, $saleId, $reason, $authorizedBy) {
            $sale = Sale::whereKey($saleId)->lockForUpdate()->first();
            if ($sale->status !== 'confirmed') {
                throw AppError::conflict('SALE_ALREADY_VOIDED', 'La venta ya está anulada');
            }
            $shift = $this->cash->lockOpenShift($sale->register_id);
            if ($shift->id !== $sale->shift_id) {
                throw AppError::conflict('SHIFT_CLOSED', 'La venta es de un turno ya cerrado: registrá una devolución');
            }
            if (SaleReturn::where('sale_id', $sale->id)->exists()) {
                throw AppError::conflict('SALE_HAS_RETURNS', 'La venta tiene devoluciones: no se puede anular');
            }

            $products = Product::whereIn('id', ProductVariant::whereIn('id', SaleLine::where('sale_id', $sale->id)->select('variant_id'))->select('product_id'))
                ->where('track_stock', true)->pluck('id');
            $tracked = ProductVariant::whereIn('product_id', $products)->pluck('id')->flip();
            $stockLines = [];
            foreach (SaleLine::where('sale_id', $sale->id)->orderBy('line_no')->get() as $line) {
                if (isset($tracked[$line->variant_id])) {
                    $stockLines[] = [
                        'warehouseId' => $sale->warehouse_id, 'variantId' => $line->variant_id, 'type' => 'return_in',
                        'quantity' => Money::quantity($line->quantity), 'sourceLineId' => $line->id, 'unitCost' => $line->unit_cost,
                    ];
                }
            }
            $this->stock->apply($stockLines, ['sourceType' => 'sale_void', 'sourceId' => $sale->id, 'reason' => "Anulación de la venta {$sale->number}: {$reason}", 'userId' => $actor->userId]);

            $cash = (string) SalePayment::where('sale_id', $sale->id)->where('kind', 'cash')->sum('amount');
            if (! BigDecimal::of($cash)->isZero()) {
                $this->cash->addMovement($actor, $shift, 'void', BigDecimal::of($cash)->negated(), [
                    'reason' => $reason, 'source_type' => 'sale', 'source_id' => $sale->id, 'authorized_by' => $authorizedBy,
                ]);
            }
            $sale->forceFill([
                'status' => 'voided', 'voided_at' => Carbon::now(), 'voided_by' => $actor->userId,
                'void_authorized_by' => $authorizedBy, 'void_reason' => $reason,
            ])->save();
            $this->record($actor, 'sale.voided', $sale->id, ['number' => $sale->number, 'total' => $sale->total, 'reason' => $reason, 'authorizedBy' => $authorizedBy], ['status' => 'confirmed']);

            return $sale;
        });
    }

    /**
     * Devolución total o parcial. El importe de cada línea es proporcional a lo devuelto; la
     * última devolución de una línea se lleva lo que quede, así nunca se devuelve de más ni
     * quedan centavos sueltos.
     *
     * @param  array{clientUuid: string, registerId: string, reason: string, paymentMethodId: string, lines: list<array{saleLineId: string, quantity: string, restock: bool}>, authorization?: ?array}  $input
     * @return array{saleReturn: SaleReturn, created: bool}
     */
    public function return(Actor $actor, string $saleId, array $input): array
    {
        if ($existing = SaleReturn::where('client_uuid', $input['clientUuid'])->first()) {
            return ['saleReturn' => $existing, 'created' => false];
        }
        $sale = Sale::find($saleId) ?? throw AppError::notFound('Venta');
        $this->cash->assertBranch($actor, $sale->branch_id);
        $register = $this->cash->register($actor, $input['registerId']);
        $authorizedBy = $this->pins->require($actor, 'sales.return', $input['authorization'] ?? null);

        try {
            $saleReturn = DB::transaction(fn () => $this->confirmReturn($actor, $saleId, $register, $input, $authorizedBy));
        } catch (UniqueConstraintViolationException $e) {
            $existing = SaleReturn::where('client_uuid', $input['clientUuid'])->first();
            if ($existing) {
                return ['saleReturn' => $existing, 'created' => false];
            }
            throw $e;
        }

        return ['saleReturn' => $saleReturn, 'created' => true];
    }

    private function confirmReturn(Actor $actor, string $saleId, Register $register, array $input, ?string $authorizedBy): SaleReturn
    {
        $sale = Sale::whereKey($saleId)->lockForUpdate()->first();
        if ($sale->status !== 'confirmed') {
            throw AppError::conflict('SALE_VOIDED', 'La venta está anulada: no admite devoluciones');
        }
        $shift = $this->cash->lockOpenShift($register->id);
        $method = PaymentMethod::find($input['paymentMethodId']);
        if (! $method || ! $method->active) {
            throw AppError::validation([['path' => 'paymentMethodId', 'message' => 'Medio de pago inexistente o desactivado']]);
        }

        $saleLines = SaleLine::where('sale_id', $sale->id)->lockForUpdate()->get()->keyBy('id');
        $returned = SaleReturnLine::whereIn('sale_line_id', $saleLines->keys())
            ->groupBy('sale_line_id')->selectRaw('sale_line_id, SUM(amount) AS amount')->pluck('amount', 'sale_line_id');
        $rows = [];
        $total = BigDecimal::zero();
        foreach ($input['lines'] as $i => $l) {
            $line = $saleLines[$l['saleLineId']] ?? throw AppError::validation([['path' => "lines.{$i}.saleLineId", 'message' => 'La línea no es de esta venta']]);
            $quantity = BigDecimal::of(Money::quantity($l['quantity']));
            $remaining = BigDecimal::of($line->quantity)->minus($line->returned_quantity);
            if ($quantity->isGreaterThan($remaining)) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => 'Quedan '.Money::quantity($remaining)." de {$line->description} para devolver"]]);
            }
            if ($line->sale_mode === 'unit' && $quantity->hasNonZeroFractionalPart()) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => 'En la venta por unidad, la cantidad tiene que ser entera']]);
            }
            $amount = $quantity->isEqualTo($remaining)
                ? Money::of($line->line_total)->minus((string) ($returned[$line->id] ?? '0'))
                : BigDecimal::of(Pricing::proportionalAmount($line->line_total, (string) $quantity, $line->quantity));
            $rows[] = ['line' => $line, 'quantity' => $quantity, 'amount' => $amount, 'restock' => (bool) $l['restock']];
            $total = $total->plus($amount);
        }

        if ($method->kind === 'cash' && $total->isGreaterThan($this->cash->expectedCash($shift))) {
            throw AppError::conflict('CASH_INSUFFICIENT', 'No hay suficiente efectivo en la caja para devolver '.Money::round($total));
        }

        $saleReturn = SaleReturn::create([
            'sale_id' => $sale->id,
            'client_uuid' => $input['clientUuid'],
            'number' => $this->setup->nextNumber($register->branch_id, 'return'),
            'branch_id' => $register->branch_id,
            'shift_id' => $shift->id,
            'reason' => $input['reason'],
            'payment_method_id' => $method->id,
            'total' => Money::round($total),
            'user_id' => $actor->userId,
            'authorized_by' => $authorizedBy,
            'created_at' => Carbon::now(),
        ]);
        $warehouse = Warehouse::where('branch_id', $register->branch_id)->where('is_default', true)->first() ?? throw AppError::notFound('Depósito');
        $tracked = Product::whereIn('id', ProductVariant::whereIn('id', collect($rows)->map(fn ($r) => $r['line']->variant_id))->select('product_id'))
            ->where('track_stock', true)->pluck('id');
        $trackedVariants = ProductVariant::whereIn('product_id', $tracked)->pluck('id')->flip();
        $stockLines = [];
        foreach ($rows as $r) {
            $returnLine = SaleReturnLine::create([
                'return_id' => $saleReturn->id, 'sale_line_id' => $r['line']->id, 'quantity' => (string) $r['quantity'],
                'amount' => Money::round($r['amount']), 'restock' => $r['restock'],
            ]);
            $r['line']->forceFill(['returned_quantity' => Money::quantity(BigDecimal::of($r['line']->returned_quantity)->plus($r['quantity']))])->save();
            if ($r['restock'] && isset($trackedVariants[$r['line']->variant_id])) {
                $stockLines[] = [
                    'warehouseId' => $warehouse->id, 'variantId' => $r['line']->variant_id, 'type' => 'return_in',
                    'quantity' => (string) $r['quantity'], 'sourceLineId' => $returnLine->id, 'unitCost' => $r['line']->unit_cost,
                ];
            }
        }
        $this->stock->apply($stockLines, ['sourceType' => 'sale_return', 'sourceId' => $saleReturn->id, 'reason' => "Devolución de la venta {$sale->number}: {$input['reason']}", 'userId' => $actor->userId]);

        if ($method->kind === 'cash' && $total->isPositive()) {
            $this->cash->addMovement($actor, $shift, 'refund', $total->negated(), [
                'reason' => $input['reason'], 'source_type' => 'sale_return', 'source_id' => $saleReturn->id, 'authorized_by' => $authorizedBy,
            ]);
        }
        $this->record($actor, 'sale.returned', $sale->id, [
            'number' => $sale->number, 'returnNumber' => $saleReturn->number, 'total' => $saleReturn->total, 'method' => $method->name,
            'reason' => $input['reason'], 'authorizedBy' => $authorizedBy,
        ]);

        return $saleReturn;
    }

    private function record(Actor $actor, string $action, string $saleId, array $after, ?array $before = null): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId,
            'actorType' => 'user',
            'actorId' => $actor->userId,
            'actorName' => $actor->userName,
            'action' => $action,
            'entityType' => 'sale',
            'entityId' => $saleId,
            'before' => $before,
            'after' => $after,
            'ip' => $actor->ip,
            'requestId' => $actor->requestId,
        ]);
    }
}
