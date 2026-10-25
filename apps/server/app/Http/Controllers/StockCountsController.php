<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockCount;
use App\Models\StockCountLine;
use App\Models\StockLevel;
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
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Inventario físico (sección 8 del diseño). Cada línea guarda el stock que figuraba cuando se
 * contó; al cerrar, la diferencia (contado − esperado) se aplica como movimiento count_adjust.
 * Así una venta hecha mientras dura el recuento no aparece como faltante.
 * En un recuento total, lo que no se contó se toma como cero al cerrar.
 */
class StockCountsController extends Controller
{
    public function __construct(
        private readonly StockService $stock,
        private readonly AuditService $audit,
    ) {}

    public function index(): JsonResponse
    {
        $counts = StockCount::orderByDesc('created_at')->limit(100)->get();

        return $this->json($this->summaries($counts));
    }

    public function show(string $id): JsonResponse
    {
        return $this->json($this->detail($id));
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'warehouseId' => ['required', 'string', 'uuid'],
            'scope' => ['required', 'string', 'in:total,partial'],
            'notes' => ['nullable', 'string', 'max:300'],
        ]);

        try {
            $count = DB::transaction(function () use ($actor, $input) {
                Warehouse::find($input['warehouseId']) ?? throw AppError::notFound('Depósito');
                $count = StockCount::create([
                    'warehouse_id' => $input['warehouseId'], 'scope' => $input['scope'], 'notes' => $input['notes'] ?? null,
                    'status' => 'open', 'created_by' => $actor->userId,
                ]);
                $this->record($actor, 'stock_count.opened', $count->id, ['scope' => $input['scope'], 'warehouseId' => $input['warehouseId']]);

                return $count;
            });
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('COUNT_ALREADY_OPEN', 'Ya hay un recuento abierto en este depósito. Cerralo o cancelalo antes de empezar otro.');
        }

        return $this->json($this->detail($count->id), 201);
    }

    /** Carga o corrige cantidades contadas. counted = null quita el artículo del recuento. */
    public function lines(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'lines' => ['required', 'array', 'list', 'min:1', 'max:500'],
            'lines.*' => ['array'],
            'lines.*.variantId' => ['required', 'string', 'uuid', 'distinct'],
            'lines.*.counted' => ['present', 'nullable', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
        ], ['lines.*.variantId.distinct' => 'El artículo está repetido']);

        DB::transaction(function () use ($actor, $id, $input) {
            $count = $this->lockOpen($id);
            $variantIds = array_column($input['lines'], 'variantId');
            $variants = ProductVariant::whereIn('id', $variantIds)->get()->keyBy('id');
            if ($variants->count() !== count($variantIds)) {
                throw AppError::notFound('Artículo');
            }
            $products = Product::whereIn('id', $variants->pluck('product_id'))->get()->keyBy('id');
            $levels = StockLevel::where('warehouse_id', $count->warehouse_id)->whereIn('variant_id', $variantIds)->pluck('on_hand', 'variant_id');
            $existing = StockCountLine::where('count_id', $id)->whereIn('variant_id', $variantIds)->get()->keyBy('variant_id');
            $now = Carbon::now();
            foreach ($input['lines'] as $i => $line) {
                $product = $products[$variants[$line['variantId']]->product_id];
                if (! $product->track_stock) {
                    throw AppError::conflict('STOCK_NOT_TRACKED', "{$product->name} no controla stock");
                }
                $current = $existing->get($line['variantId']);
                if ($line['counted'] === null) {
                    $current?->delete();

                    continue;
                }
                if ($product->sale_mode === 'unit' && BigDecimal::of($line['counted'])->hasNonZeroFractionalPart()) {
                    throw AppError::validation([['path' => "lines.{$i}.counted", 'message' => 'En la venta por unidad, la cantidad tiene que ser entera']]);
                }
                $values = [
                    'expected' => Money::quantity($levels[$line['variantId']] ?? '0'),
                    'counted' => Money::quantity($line['counted']),
                    'counted_by' => $actor->userId,
                    'counted_at' => $now,
                ];
                $current ? $current->forceFill($values)->save() : StockCountLine::create(['count_id' => $id, 'variant_id' => $line['variantId']] + $values);
            }
            $count->touch();
        });

        return $this->json($this->detail($id));
    }

    public function close(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);

        DB::transaction(function () use ($actor, $id) {
            $count = $this->lockOpen($id);
            $now = Carbon::now();
            if ($count->scope === 'total') {
                // Lo que tiene stock y no se contó, se toma como cero.
                $counted = StockCountLine::where('count_id', $id)->select('variant_id');
                $tracked = ProductVariant::whereIn('product_id', Product::where('track_stock', true)->select('id'))->select('id');
                $missing = StockLevel::where('warehouse_id', $count->warehouse_id)->where('on_hand', '<>', 0)
                    ->whereIn('variant_id', $tracked)->whereNotIn('variant_id', $counted)->get();
                StockCountLine::insertForTenant($missing->map(fn (StockLevel $l) => [
                    'id' => (string) Str::uuid7(), 'count_id' => $id, 'variant_id' => $l->variant_id, 'expected' => $l->on_hand,
                    'counted' => '0', 'counted_by' => $actor->userId, 'counted_at' => $now->format('Y-m-d H:i:s.u'),
                ])->all());
            }
            $lines = [];
            foreach (StockCountLine::where('count_id', $id)->orderBy('variant_id')->get() as $line) {
                $diff = BigDecimal::of($line->counted)->minus($line->expected);
                if (! $diff->isZero()) {
                    $lines[] = [
                        'warehouseId' => $count->warehouse_id, 'variantId' => $line->variant_id, 'type' => 'count_adjust',
                        'quantity' => Money::quantity($diff), 'sourceLineId' => $line->id,
                    ];
                }
            }
            $movements = $this->stock->apply($lines, [
                'sourceType' => 'stock_count', 'sourceId' => $id, 'reason' => 'Inventario físico', 'userId' => $actor->userId, 'allowNegative' => true,
            ]);
            $count->forceFill(['status' => 'closed', 'closed_by' => $actor->userId, 'closed_at' => $now])->save();
            $this->record($actor, 'stock_count.closed', $id, ['adjustedLines' => count($movements)]);
        });

        return $this->json($this->detail($id));
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        DB::transaction(function () use ($actor, $id) {
            $count = $this->lockOpen($id);
            $count->forceFill(['status' => 'cancelled', 'closed_by' => $actor->userId, 'closed_at' => Carbon::now()])->save();
            $this->record($actor, 'stock_count.cancelled', $id, null);
        });

        return $this->json($this->detail($id));
    }

    private function lockOpen(string $id): StockCount
    {
        $count = StockCount::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Recuento');
        if ($count->status !== 'open') {
            throw AppError::conflict('COUNT_NOT_OPEN', 'El recuento ya está cerrado o cancelado');
        }

        return $count;
    }

    private function summaries($counts): array
    {
        $warehouses = Warehouse::whereIn('id', $counts->pluck('warehouse_id')->unique())->pluck('name', 'id');
        $users = User::whereIn('id', $counts->pluck('created_by')->unique())->pluck('name', 'id');
        $lineCounts = StockCountLine::whereIn('count_id', $counts->pluck('id'))->groupBy('count_id')->selectRaw('count_id, COUNT(*) AS n')->pluck('n', 'count_id');

        return $counts->map(fn (StockCount $c) => [
            'id' => $c->id,
            'warehouseId' => $c->warehouse_id,
            'warehouseName' => $warehouses[$c->warehouse_id] ?? '',
            'scope' => $c->scope,
            'status' => $c->status,
            'notes' => $c->notes,
            'createdAt' => Dates::iso($c->created_at),
            'createdByName' => $users[$c->created_by] ?? null,
            'closedAt' => Dates::iso($c->closed_at),
            'lineCount' => (int) ($lineCounts[$c->id] ?? 0),
        ])->values()->all();
    }

    private function detail(string $id): array
    {
        $count = StockCount::find($id) ?? throw AppError::notFound('Recuento');
        $lines = StockCountLine::where('count_id', $id)->orderByDesc('counted_at')->get();
        $variants = ProductVariant::whereIn('id', $lines->pluck('variant_id'))->get()->keyBy('id');
        $products = Product::whereIn('id', $variants->pluck('product_id'))->get()->keyBy('id');

        return $this->summaries(collect([$count]))[0] + [
            'lines' => $lines->map(function (StockCountLine $l) use ($variants, $products) {
                $v = $variants[$l->variant_id];
                $p = $products[$v->product_id];

                return [
                    'variantId' => $l->variant_id,
                    'productId' => $p->id,
                    'name' => $p->name,
                    'sku' => $v->sku,
                    'saleMode' => $p->sale_mode,
                    'expected' => Money::quantity($l->expected),
                    'counted' => Money::quantity($l->counted),
                    'difference' => Money::quantity(BigDecimal::of($l->counted)->minus($l->expected)),
                    'countedAt' => Dates::iso($l->counted_at),
                ];
            })->all(),
        ];
    }

    private function record(Actor $actor, string $action, string $id, ?array $after): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId,
            'actorType' => 'user',
            'actorId' => $actor->userId,
            'actorName' => $actor->userName,
            'action' => $action,
            'entityType' => 'stock_count',
            'entityId' => $id,
            'after' => $after,
            'ip' => $actor->ip,
            'requestId' => $actor->requestId,
        ]);
    }
}
