<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Branch;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\AuditService;
use App\Services\StockService;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

/** Stock por depósito, historial de movimientos, ajustes y mermas (sección 8 del diseño). */
class StockController extends Controller
{
    public const MOVEMENT_TYPES = ['adjust', 'waste', 'expired', 'count_adjust', 'purchase_in', 'sale_out', 'return_in', 'transfer_out', 'transfer_in'];

    public function __construct(
        private readonly StockService $stock,
        private readonly AuditService $audit,
    ) {}

    public function warehouses(): JsonResponse
    {
        $branches = Branch::pluck('name', 'id');

        return $this->json(Warehouse::orderBy('created_at')->get()->map(fn (Warehouse $w) => [
            'id' => $w->id, 'name' => $w->name, 'branchId' => $w->branch_id, 'branchName' => $branches[$w->branch_id] ?? '', 'isDefault' => $w->is_default,
        ])->all());
    }

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'warehouseId' => ['nullable', 'string', 'uuid'],
            'q' => ['nullable', 'string', 'max:100'],
            'categoryId' => ['nullable', 'string', 'uuid'],
            'low' => ['nullable', 'string', 'in:0,1'],
        ]);
        $warehouse = $this->warehouse($q['warehouseId'] ?? null);

        $query = ProductsController::search(Product::query(), $q['q'] ?? null)
            ->join('product_variants', function ($j) {
                $j->on('product_variants.tenant_id', '=', 'products.tenant_id')->on('product_variants.product_id', '=', 'products.id');
            })
            ->join('stock_levels', function ($j) use ($warehouse) {
                $j->on('stock_levels.tenant_id', '=', 'product_variants.tenant_id')->on('stock_levels.variant_id', '=', 'product_variants.id')
                    ->where('stock_levels.warehouse_id', '=', $warehouse->id);
            })
            ->leftJoin('categories', function ($j) {
                $j->on('categories.tenant_id', '=', 'products.tenant_id')->on('categories.id', '=', 'products.category_id');
            })
            ->where('products.track_stock', true)
            ->where('products.status', 'active')
            ->when($q['categoryId'] ?? null, fn ($w, $id) => $w->where('products.category_id', $id))
            ->when(($q['low'] ?? '0') === '1', fn ($w) => $w->whereNotNull('products.min_stock')->whereColumn('stock_levels.on_hand', '<=', 'products.min_stock'));
        $total = (clone $query)->count();
        $rows = $query->orderBy('products.name')->orderBy('products.id')->forPage($page, $pageSize)->get([
            'products.id as product_id', 'product_variants.id as variant_id', 'products.name', 'product_variants.sku', 'categories.name as category_name',
            'products.sale_mode', 'stock_levels.on_hand', 'products.min_stock', 'product_variants.cost',
        ]);
        $seeCost = $actor->can('costs.read');

        return $this->json([
            'items' => $rows->map(fn ($r) => [
                'productId' => $r->product_id,
                'variantId' => $r->variant_id,
                'name' => $r->name,
                'sku' => $r->sku,
                'categoryName' => $r->category_name,
                'saleMode' => $r->sale_mode,
                'onHand' => Money::quantity($r->on_hand),
                'minStock' => $r->min_stock === null ? null : Money::quantity($r->min_stock),
                'low' => $r->min_stock !== null && BigDecimal::of($r->on_hand)->isLessThanOrEqualTo($r->min_stock),
                'cost' => $seeCost && $r->cost !== null ? Money::roundUnit($r->cost) : null,
            ])->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    public function movements(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'warehouseId' => ['nullable', 'string', 'uuid'],
            'productId' => ['nullable', 'string', 'uuid'],
            'type' => ['nullable', 'string', 'in:'.implode(',', self::MOVEMENT_TYPES)],
        ]);
        $query = StockMovement::query()
            ->when($q['warehouseId'] ?? null, fn ($w, $id) => $w->where('warehouse_id', $id))
            ->when($q['productId'] ?? null, fn ($w, $id) => $w->whereIn('variant_id', ProductVariant::where('product_id', $id)->select('id')))
            ->when($q['type'] ?? null, fn ($w, $t) => $w->where('type', $t));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('occurred_at')->orderByDesc('id')->forPage($page, $pageSize)->get();

        $variants = ProductVariant::whereIn('id', $rows->pluck('variant_id')->unique())->pluck('product_id', 'id');
        $products = Product::whereIn('id', $variants->unique())->pluck('name', 'id');
        $warehouses = Warehouse::whereIn('id', $rows->pluck('warehouse_id')->unique())->pluck('name', 'id');
        $users = User::whereIn('id', $rows->pluck('user_id')->filter()->unique())->pluck('name', 'id');
        $seeCost = $actor->can('costs.read');

        return $this->json([
            'items' => $rows->map(fn (StockMovement $m) => [
                'id' => $m->id,
                'occurredAt' => Dates::iso($m->occurred_at),
                'type' => $m->type,
                'productId' => $variants[$m->variant_id] ?? null,
                'variantId' => $m->variant_id,
                'productName' => $products[$variants[$m->variant_id] ?? ''] ?? '',
                'warehouseName' => $warehouses[$m->warehouse_id] ?? '',
                'quantity' => Money::quantity($m->quantity),
                'balanceAfter' => Money::quantity($m->balance_after),
                'unitCost' => $seeCost && $m->unit_cost !== null ? Money::roundUnit($m->unit_cost) : null,
                'reason' => $m->reason,
                'userName' => $users[$m->user_id] ?? null,
                'sourceType' => $m->source_type,
                'sourceId' => $m->source_id,
            ])->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    /** Ajuste manual (+ o −, o "el stock real es X"). Motivo obligatorio. */
    public function adjust(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            ...self::operationRules(),
            'lines.*.mode' => ['required', 'string', 'in:delta,set'],
            'lines.*.quantity' => ['required', ...Input::decimal(Input::SIGNED_QUANTITY, 'Cantidad inválida')],
        ], self::operationMessages());
        $details = [];
        foreach ($input['lines'] as $i => $line) {
            if ($line['mode'] === 'set' && BigDecimal::of($line['quantity'])->isNegative()) {
                $details[] = ['path' => "lines.{$i}.quantity", 'message' => 'El stock contado no puede ser negativo'];
            }
            if ($line['mode'] === 'delta' && BigDecimal::of($line['quantity'])->isZero()) {
                $details[] = ['path' => "lines.{$i}.quantity", 'message' => 'La cantidad no puede ser cero'];
            }
        }
        if ($details !== []) {
            throw AppError::validation($details);
        }

        return $this->operation($actor, $input, 'adjustment', 'stock.adjusted', fn ($line) => $line['mode'] === 'set'
            ? ['type' => 'adjust', 'set' => Money::quantity($line['quantity'])]
            : ['type' => 'adjust', 'quantity' => Money::quantity($line['quantity'])]);
    }

    /** Merma, rotura o vencimiento: siempre resta y se valoriza al costo vigente. */
    public function waste(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            ...self::operationRules(),
            'type' => ['required', 'string', 'in:waste,expired'],
            'lines.*.quantity' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
        ], self::operationMessages());
        foreach ($input['lines'] as $i => $line) {
            if (BigDecimal::of($line['quantity'])->isZero()) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => 'La cantidad no puede ser cero']]);
            }
        }

        return $this->operation($actor, $input, 'waste', 'stock.wasted', fn ($line) => [
            'type' => $input['type'], 'quantity' => Money::quantity(BigDecimal::of($line['quantity'])->negated()),
        ]);
    }

    /**
     * Aplica una operación manual de stock de forma idempotente: el mismo clientUuid no genera
     * movimientos dos veces, aunque los dos pedidos lleguen a la vez.
     */
    private function operation(Actor $actor, array $input, string $sourceType, string $action, \Closure $toLine): JsonResponse
    {
        $already = fn () => StockMovement::where('source_type', $sourceType)->where('source_id', $input['clientUuid'])->exists();
        if ($already()) {
            return $this->json(['created' => false, 'movements' => 0]);
        }
        try {
            $count = DB::transaction(function () use ($actor, $input, $sourceType, $action, $toLine) {
                $warehouse = Warehouse::find($input['warehouseId']) ?? throw AppError::notFound('Depósito');
                $this->assertQuantitiesFit($input['lines']);
                $lines = [];
                foreach ($input['lines'] as $i => $line) {
                    $lines[] = [
                        'warehouseId' => $warehouse->id,
                        'variantId' => $line['variantId'],
                        'sourceLineId' => Uuid::uuid5($input['clientUuid'], (string) $i)->toString(),
                    ] + $toLine($line);
                }
                $created = $this->stock->apply($lines, ['sourceType' => $sourceType, 'sourceId' => $input['clientUuid'], 'reason' => $input['reason'], 'userId' => $actor->userId]);
                $this->audit->record([
                    'tenantId' => $actor->tenantId,
                    'actorType' => 'user',
                    'actorId' => $actor->userId,
                    'actorName' => $actor->userName,
                    'action' => $action,
                    'entityType' => 'warehouse',
                    'entityId' => $warehouse->id,
                    'after' => [
                        'reason' => $input['reason'],
                        'type' => $input['type'] ?? 'adjust',
                        'lines' => array_map(fn ($m) => ['variantId' => $m->variant_id, 'quantity' => $m->quantity, 'balanceAfter' => $m->balance_after], $created),
                    ],
                    'ip' => $actor->ip,
                    'requestId' => $actor->requestId,
                ]);

                return count($created);
            });
        } catch (UniqueConstraintViolationException $e) {
            if ($already()) {
                return $this->json(['created' => false, 'movements' => 0]);
            }
            throw $e;
        }

        return $this->json(['created' => true, 'movements' => $count], 201);
    }

    /** En los artículos que se venden por unidad, las cantidades son enteras. */
    private function assertQuantitiesFit(array $lines): void
    {
        $modes = ProductVariant::whereIn('product_variants.id', array_column($lines, 'variantId'))
            ->join('products', function ($j) {
                $j->on('products.tenant_id', '=', 'product_variants.tenant_id')->on('products.id', '=', 'product_variants.product_id');
            })->pluck('products.sale_mode', 'product_variants.id');
        foreach ($lines as $i => $line) {
            if (($modes[$line['variantId']] ?? null) === 'unit' && BigDecimal::of($line['quantity'])->hasNonZeroFractionalPart()) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => 'En la venta por unidad, la cantidad tiene que ser entera']]);
            }
        }
    }

    private function warehouse(?string $id): Warehouse
    {
        return ($id ? Warehouse::find($id) : Warehouse::where('is_default', true)->orderBy('created_at')->first()) ?? throw AppError::notFound('Depósito');
    }

    private static function operationRules(): array
    {
        return [
            'clientUuid' => ['required', 'string', 'uuid'],
            'warehouseId' => ['required', 'string', 'uuid'],
            'reason' => ['required', 'string', 'max:200'],
            'lines' => ['required', 'array', 'list', 'min:1', 'max:200'],
            'lines.*' => ['array'],
            'lines.*.variantId' => ['required', 'string', 'uuid', 'distinct'],
        ];
    }

    private static function operationMessages(): array
    {
        return ['lines.required' => 'Agregá al menos un artículo', 'lines.min' => 'Agregá al menos un artículo', 'lines.*.variantId.distinct' => 'El artículo está repetido'];
    }
}
