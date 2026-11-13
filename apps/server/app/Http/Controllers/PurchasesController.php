<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use App\Models\Supplier;
use App\Models\SupplierMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\AuditService;
use App\Services\ProductService;
use App\Services\SalesSetup;
use App\Services\StockService;
use App\Services\SupplierAccountService;
use App\Support\AppError;
use App\Support\Cuit;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Ingreso de mercadería y proveedores (ADR 0014). Recibir suma stock con un movimiento
 * «purchase_in» por línea; el costo informado puede actualizar el costo vigente de la variante.
 */
class PurchasesController extends Controller
{
    public function __construct(
        private readonly AuditService $audit,
        private readonly SupplierAccountService $accounts,
        private readonly StockService $stock,
        private readonly ProductService $products,
        private readonly SalesSetup $setup,
    ) {}

    // ------------------------------------------------------------------ Proveedores

    public function suppliers(): JsonResponse
    {
        return $this->json(Supplier::orderBy('name')->get()->map(fn (Supplier $s) => $this->supplierDto($s))->all());
    }

    public function storeSupplier(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->supplierInput($request);
        $supplier = $this->uniqueName(fn () => DB::transaction(function () use ($actor, $input) {
            $supplier = Supplier::create($input);
            $this->record($actor, 'supplier.created', 'supplier', $supplier->id, null, $input);

            return $supplier;
        }));

        return $this->json($this->supplierDto($supplier), 201);
    }

    public function updateSupplier(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->supplierInput($request, true);
        $supplier = $this->uniqueName(fn () => DB::transaction(function () use ($actor, $id, $input) {
            $supplier = Supplier::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Proveedor');
            $before = $supplier->only(array_keys($input));
            $supplier->forceFill($input)->save();
            $this->record($actor, 'supplier.updated', 'supplier', $id, $before, $input);

            return $supplier;
        }));

        return $this->json($this->supplierDto($supplier));
    }

    /** Ficha del proveedor con los movimientos de su cuenta (ADR 0018). */
    public function showSupplier(Request $request, string $id): JsonResponse
    {
        $supplier = Supplier::find($id) ?? throw AppError::notFound('Proveedor');
        $moves = SupplierMovement::where('supplier_id', $id)->orderByDesc('created_at')->orderByDesc('id')->limit(200)->get();
        $purchases = Purchase::whereIn('id', $moves->pluck('purchase_id')->filter())->get(['id', 'number', 'document'])->keyBy('id');
        $users = User::whereIn('id', $moves->pluck('user_id')->unique())->pluck('name', 'id');

        return $this->json($this->supplierDto($supplier) + [
            'movements' => $moves->map(fn (SupplierMovement $m) => [
                'id' => $m->id, 'kind' => $m->kind, 'amount' => Money::round($m->amount), 'balanceAfter' => Money::round($m->balance_after),
                'method' => $m->method, 'reference' => $m->reference, 'notes' => $m->notes, 'createdAt' => Dates::iso($m->created_at), 'userName' => $users[$m->user_id] ?? '',
                'purchase' => isset($purchases[$m->purchase_id]) ? ['id' => $m->purchase_id, 'number' => (int) $purchases[$m->purchase_id]->number, 'document' => $purchases[$m->purchase_id]->document] : null,
            ])->all(),
        ]);
    }

    /** Pago al proveedor: en efectivo sale de una caja abierta; se reintenta sin duplicar. */
    public function paySupplier(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'amount' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'method' => ['required', 'in:cash,transfer,check,other'],
            'registerId' => ['required_if:method,cash', 'nullable', 'string', 'uuid'],
            'reference' => ['nullable', 'string', 'max:80'],
            'notes' => ['nullable', 'string', 'max:200'],
        ], ['registerId.required_if' => 'Elegí la caja de la que sale el efectivo']);
        if (Money::of($v['amount'])->isZero()) {
            throw AppError::validation([['path' => 'amount', 'message' => 'El importe no puede ser cero']]);
        }
        Supplier::whereKey($id)->exists() || throw AppError::notFound('Proveedor');
        if (SupplierMovement::where('client_uuid', $v['clientUuid'])->exists()) {
            return $this->json($this->supplierDto(Supplier::find($id)));
        }
        try {
            $supplier = DB::transaction(function () use ($actor, $id, $v) {
                $supplier = Supplier::whereKey($id)->lockForUpdate()->first();
                $before = Money::round($supplier->balance);
                $this->accounts->pay($actor, $supplier, $v);
                $this->record($actor, 'supplier.paid', 'supplier', $id, ['balance' => $before], ['balance' => Money::round($supplier->balance), 'amount' => Money::round($v['amount']), 'method' => $v['method']]);

                return $supplier;
            });
        } catch (UniqueConstraintViolationException $e) {
            SupplierMovement::where('client_uuid', $v['clientUuid'])->exists() || throw $e;
            $supplier = Supplier::find($id);
        }

        return $this->json($this->supplierDto($supplier), 201);
    }

    /** Saldo inicial al empezar a usar el sistema, o una corrección con motivo. */
    public function adjustSupplier(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'amount' => ['required', 'string', 'regex:/^-?\d{1,12}(\.\d{1,2})?$/'],
            'notes' => ['required', 'string', 'max:200'],
        ], ['amount.regex' => 'Importe inválido']);
        if (Money::of($v['amount'])->isZero()) {
            throw AppError::validation([['path' => 'amount', 'message' => 'El importe no puede ser cero']]);
        }
        $supplier = DB::transaction(function () use ($actor, $id, $v) {
            $supplier = Supplier::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Proveedor');
            $before = Money::round($supplier->balance);
            $this->accounts->adjust($actor, $supplier, Money::of($v['amount']), trim($v['notes']));
            $this->record($actor, 'supplier.balance_adjusted', 'supplier', $id, ['balance' => $before], ['balance' => Money::round($supplier->balance), 'amount' => Money::round($v['amount']), 'notes' => trim($v['notes'])]);

            return $supplier;
        });

        return $this->json($this->supplierDto($supplier));
    }

    /** Mismos límites que supplierSchema de packages/contracts. */
    private function supplierInput(Request $request, bool $withStatus = false): array
    {
        $v = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:120'],
            'cuit' => ['nullable', 'string', Input::cuitRule()],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'string', 'email', 'max:254'],
            'notes' => ['nullable', 'string', 'max:300'],
            ...($withStatus ? ['status' => ['required', 'in:active,inactive']] : []),
        ]);

        return [
            'name' => $v['name'], 'cuit' => isset($v['cuit']) ? Cuit::normalize($v['cuit']) : null, 'phone' => $v['phone'] ?? null,
            'email' => isset($v['email']) ? mb_strtolower($v['email']) : null, 'notes' => $v['notes'] ?? null,
            ...($withStatus ? ['status' => $v['status']] : []),
        ];
    }

    private function uniqueName(\Closure $fn): Supplier
    {
        try {
            return $fn();
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('NAME_TAKEN', 'Ya hay un proveedor con ese nombre');
        }
    }

    private function supplierDto(Supplier $s): array
    {
        return ['id' => $s->id, 'name' => $s->name, 'cuit' => $s->cuit, 'phone' => $s->phone, 'email' => $s->email, 'notes' => $s->notes, 'status' => $s->status, 'balance' => Money::round($s->balance ?? '0')];
    }

    // ------------------------------------------------------------------ Compras

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), ['supplierId' => ['nullable', 'string', 'uuid']]);
        $query = Purchase::query()->when($q['supplierId'] ?? null, fn ($w, $id) => $w->where('supplier_id', $id));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->orderByDesc('id')->forPage($page, $pageSize)->get();

        return $this->json(['items' => $this->dtos($rows, $actor, false), 'total' => $total, 'page' => $page, 'pageSize' => $pageSize]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $purchase = Purchase::find($id) ?? throw AppError::notFound('Compra');

        return $this->json($this->dtos(collect([$purchase]), $this->actor($request), true)[0]);
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'warehouseId' => ['required', 'string', 'uuid'],
            'supplierId' => ['present', 'nullable', 'string', 'uuid'],
            'document' => ['nullable', 'string', 'max:60'],
            'notes' => ['nullable', 'string', 'max:300'],
            'updateCosts' => ['present', Input::strictBoolean()],
            'payableAmount' => ['nullable', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'lines' => ['required', 'array', 'list', 'min:1', 'max:300'],
            'lines.*' => ['array'],
            'lines.*.variantId' => ['required', 'string', 'uuid', 'distinct'],
            'lines.*.quantity' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
            'lines.*.unitCost' => ['present', 'nullable', ...Input::decimal(Input::COST, 'Costo inválido')],
        ], ['lines.required' => 'Agregá al menos un artículo', 'lines.min' => 'Agregá al menos un artículo', 'lines.*.variantId.distinct' => 'El artículo está repetido']);
        foreach ($v['lines'] as $i => $line) {
            if (BigDecimal::of($line['quantity'])->isZero()) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => 'La cantidad no puede ser cero']]);
            }
        }
        // Cargar el costo de lo que se compra es ver y cambiar costos.
        if (collect($v['lines'])->contains(fn ($l) => isset($l['unitCost'])) && ! $actor->can('costs.update')) {
            throw AppError::forbidden('costs.update');
        }
        // Lo que queda para pagar al proveedor es información de compras, no de quien solo recibe.
        if (isset($v['payableAmount'])) {
            if (! $actor->can('purchases.create')) {
                throw AppError::forbidden('purchases.create');
            }
            if (! $v['supplierId']) {
                throw AppError::validation([['path' => 'payableAmount', 'message' => 'Para dejar un importe a pagar, elegí el proveedor']]);
            }
            if (Money::of($v['payableAmount'])->isZero()) {
                throw AppError::validation([['path' => 'payableAmount', 'message' => 'El importe no puede ser cero']]);
            }
        }
        if ($existing = Purchase::where('client_uuid', $v['clientUuid'])->first()) {
            return $this->json($this->dtos(collect([$existing]), $actor, true)[0]);
        }

        try {
            $purchase = DB::transaction(fn () => $this->receive($actor, $v));
        } catch (UniqueConstraintViolationException $e) {
            $purchase = Purchase::where('client_uuid', $v['clientUuid'])->first() ?? throw $e;

            return $this->json($this->dtos(collect([$purchase]), $actor, true)[0]);
        }

        return $this->json($this->dtos(collect([$purchase]), $actor, true)[0], 201);
    }

    private function receive(Actor $actor, array $v): Purchase
    {
        $warehouse = Warehouse::find($v['warehouseId']) ?? throw AppError::notFound('Depósito');
        $supplier = $v['supplierId'] ? (Supplier::whereKey($v['supplierId'])->when(isset($v['payableAmount']), fn ($q) => $q->lockForUpdate())->first() ?? throw AppError::notFound('Proveedor')) : null;
        $variants = ProductVariant::whereIn('id', array_column($v['lines'], 'variantId'))->lockForUpdate()->get()->keyBy('id');
        $products = Product::whereIn('id', $variants->pluck('product_id'))->get()->keyBy('id');
        $total = BigDecimal::zero();
        $allCosts = true;
        foreach ($v['lines'] as $i => $line) {
            $variant = $variants[$line['variantId']] ?? throw AppError::validation([['path' => "lines.{$i}.variantId", 'message' => 'El artículo no existe']]);
            $product = $products[$variant->product_id];
            if ($product->sale_mode === 'unit' && BigDecimal::of($line['quantity'])->hasNonZeroFractionalPart()) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => 'En la venta por unidad, la cantidad tiene que ser entera']]);
            }
            if (isset($line['unitCost'])) {
                $total = $total->plus(BigDecimal::of($line['quantity'])->multipliedBy($line['unitCost']));
            } else {
                $allCosts = false;
            }
        }

        $purchase = Purchase::create([
            'client_uuid' => $v['clientUuid'],
            'number' => $this->setup->nextNumber($warehouse->branch_id, 'purchase'),
            'branch_id' => $warehouse->branch_id,
            'warehouse_id' => $warehouse->id,
            'supplier_id' => $supplier?->id,
            'document' => $v['document'] ?? null,
            'notes' => $v['notes'] ?? null,
            'total_cost' => $allCosts ? Money::roundUnit($total) : null,
            'updated_costs' => (bool) $v['updateCosts'],
            'payable_amount' => isset($v['payableAmount']) ? Money::round($v['payableAmount']) : null,
            'created_by' => $actor->userId,
            'created_at' => now(),
        ]);
        $stockLines = [];
        foreach ($v['lines'] as $n => $line) {
            $variant = $variants[$line['variantId']];
            $cost = isset($line['unitCost']) ? Money::roundUnit($line['unitCost']) : null;
            $purchaseLine = PurchaseLine::create([
                'purchase_id' => $purchase->id, 'line_no' => $n + 1, 'variant_id' => $variant->id,
                'description' => ProductVariant::displayName($products[$variant->product_id]->name, $variant->label),
                'quantity' => Money::quantity($line['quantity']), 'unit_cost' => $cost,
            ]);
            $stockLines[] = [
                'warehouseId' => $warehouse->id, 'variantId' => $variant->id, 'type' => 'purchase_in',
                'quantity' => Money::quantity($line['quantity']), 'sourceLineId' => $purchaseLine->id, 'unitCost' => $cost ?? $variant->cost,
            ];
            if ($v['updateCosts'] && $cost !== null) {
                $this->products->setCost($variant, $cost, 'purchase', $actor->userId);
            }
        }
        if ($purchase->payable_amount !== null) {
            $this->accounts->purchase($actor, $supplier, $purchase->id, Money::of($purchase->payable_amount));
        }
        $reason = "Compra N° {$purchase->number}".($supplier ? " · {$supplier->name}" : '').($purchase->document ? " · {$purchase->document}" : '');
        $this->stock->apply($stockLines, ['sourceType' => 'purchase', 'sourceId' => $purchase->id, 'reason' => $reason, 'userId' => $actor->userId]);
        $this->record($actor, 'purchase.created', 'purchase', $purchase->id, null, [
            'number' => $purchase->number, 'supplier' => $supplier?->name, 'document' => $purchase->document, 'lines' => count($stockLines),
            'totalCost' => $purchase->total_cost === null ? null : Money::round($purchase->total_cost), 'updatedCosts' => $purchase->updated_costs,
            'payableAmount' => $purchase->payable_amount === null ? null : Money::round($purchase->payable_amount),
        ]);

        return $purchase;
    }

    /**
     * Forma de PurchaseDto. Los costos solo para quien puede verlos.
     *
     * @param  Collection<int, Purchase>  $purchases
     */
    private function dtos(Collection $purchases, Actor $actor, bool $withLines): array
    {
        $suppliers = Supplier::whereIn('id', $purchases->pluck('supplier_id')->filter()->unique())->pluck('name', 'id');
        $warehouses = Warehouse::whereIn('id', $purchases->pluck('warehouse_id')->unique())->pluck('name', 'id');
        $users = User::whereIn('id', $purchases->pluck('created_by')->unique())->pluck('name', 'id');
        $lines = $withLines ? PurchaseLine::whereIn('purchase_id', $purchases->pluck('id'))->orderBy('line_no')->get()->groupBy('purchase_id') : collect();
        $counts = PurchaseLine::whereIn('purchase_id', $purchases->pluck('id'))->groupBy('purchase_id')->selectRaw('purchase_id, COUNT(*) AS n')->pluck('n', 'purchase_id');
        $seeCost = $actor->can('costs.read');

        return $purchases->map(fn (Purchase $p) => [
            'id' => $p->id,
            'number' => $p->number,
            'createdAt' => Dates::iso($p->created_at),
            'supplierId' => $p->supplier_id,
            'supplierName' => $suppliers[$p->supplier_id] ?? null,
            'warehouseName' => $warehouses[$p->warehouse_id] ?? '',
            'document' => $p->document,
            'notes' => $p->notes,
            'totalCost' => $seeCost && $p->total_cost !== null ? Money::round($p->total_cost) : null,
            'updatedCosts' => $p->updated_costs,
            'payableAmount' => $p->payable_amount === null ? null : Money::round($p->payable_amount),
            'createdByName' => $users[$p->created_by] ?? null,
            'lineCount' => (int) ($counts[$p->id] ?? 0),
            'lines' => $withLines ? collect($lines->get($p->id, []))->map(fn (PurchaseLine $l) => [
                'variantId' => $l->variant_id, 'description' => $l->description, 'quantity' => Money::quantity($l->quantity),
                'unitCost' => $seeCost && $l->unit_cost !== null ? Money::roundUnit($l->unit_cost) : null,
            ])->values()->all() : null,
        ])->values()->all();
    }

    private function record(Actor $actor, string $action, string $type, string $id, ?array $before, ?array $after): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
            'action' => $action, 'entityType' => $type, 'entityId' => $id, 'before' => $before, 'after' => $after,
            'ip' => $actor->ip, 'requestId' => $actor->requestId,
        ]);
    }
}
