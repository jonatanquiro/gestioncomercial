<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Support\AppError;
use App\Support\Money;
use App\Tenancy\TenantContext;
use Brick\Math\BigDecimal;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Único punto que cambia el stock (sección 8 del diseño). Cada cambio inserta un movimiento y
 * actualiza el saldo materializado en la misma transacción, con la fila de stock_levels
 * bloqueada (FOR UPDATE, en orden fijo para no generar bloqueos cruzados). Así el saldo
 * siempre coincide con la suma de los movimientos.
 *
 * Se llama siempre dentro de DB::transaction.
 */
class StockService
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  list<array{warehouseId: string, variantId: string, type: string, sourceLineId: string, quantity?: string, set?: string, unitCost?: ?string}>  $lines
     *                                                                                                                                                               quantity con signo (+ entra, − sale), o set con el saldo final buscado (ajustes)
     * @param  array{sourceType: string, sourceId: ?string, reason: ?string, userId: ?string, allowNegative?: bool}  $meta
     *                                                                                                                      allowNegative: el recuento físico corrige el saldo aunque quede negativo
     * @return list<StockMovement> movimientos creados (los ajustes que no cambian el saldo no generan movimiento)
     */
    public function apply(array $lines, array $meta): array
    {
        if ($lines === []) {
            return [];
        }
        $variantIds = array_values(array_unique(array_column($lines, 'variantId')));
        $warehouseIds = array_values(array_unique(array_column($lines, 'warehouseId')));

        $variants = ProductVariant::whereIn('id', $variantIds)->get()->keyBy('id');
        $products = Product::whereIn('id', $variants->pluck('product_id'))->get()->keyBy('id');
        if ($variants->count() !== count($variantIds)) {
            throw AppError::notFound('Artículo');
        }
        if (Warehouse::whereIn('id', $warehouseIds)->count() !== count($warehouseIds)) {
            throw AppError::notFound('Depósito');
        }
        foreach ($variants as $variant) {
            if (! $products[$variant->product_id]->track_stock) {
                throw AppError::conflict('STOCK_NOT_TRACKED', "{$products[$variant->product_id]->name} no controla stock");
            }
        }

        $levels = $this->lockLevels($warehouseIds, $variantIds);
        $tenant = Tenant::find($this->context->id());
        $allowNegative = (bool) ($tenant->settings['allowNegativeStock'] ?? true);
        $force = (bool) ($meta['allowNegative'] ?? false);

        $now = Carbon::now();
        $created = [];
        $insufficient = [];
        foreach ($lines as $line) {
            $level = $levels["{$line['warehouseId']}|{$line['variantId']}"];
            $before = BigDecimal::of($level->on_hand);
            $delta = isset($line['set']) ? BigDecimal::of($line['set'])->minus($before) : BigDecimal::of($line['quantity']);
            if ($delta->isZero()) {
                continue;
            }
            $after = $before->plus($delta);
            $product = $products[$variants[$line['variantId']]->product_id];
            if (! $force && $delta->isNegative() && $after->isNegative() && (! $allowNegative || $product->block_negative_stock)) {
                $insufficient[] = ['variantId' => $line['variantId'], 'name' => $product->name, 'onHand' => Money::quantity($before), 'requested' => Money::quantity($delta->negated())];

                continue;
            }
            $level->forceFill(['on_hand' => Money::quantity($after), 'version' => $level->version + 1])->save();
            $created[] = StockMovement::create([
                'warehouse_id' => $line['warehouseId'],
                'variant_id' => $line['variantId'],
                'type' => $line['type'],
                'quantity' => Money::quantity($delta),
                'balance_after' => Money::quantity($after),
                'unit_cost' => $line['unitCost'] ?? $variants[$line['variantId']]->cost,
                'reason' => $meta['reason'],
                'source_type' => $meta['sourceType'],
                'source_id' => $meta['sourceId'],
                'source_line_id' => $line['sourceLineId'],
                'user_id' => $meta['userId'],
                'occurred_at' => $now,
            ]);
        }
        if ($insufficient !== []) {
            throw new AppError(409, 'INSUFFICIENT_STOCK', 'No hay stock suficiente y el comercio no permite stock negativo', $insufficient);
        }

        return $created;
    }

    /** Crea el saldo en cero de una variante nueva en todos los depósitos. */
    public function initVariant(string $variantId): void
    {
        $now = Carbon::now()->format('Y-m-d H:i:s.u');
        StockLevel::insertForTenant(Warehouse::pluck('id')->map(fn ($w) => [
            'id' => (string) Str::uuid7(), 'warehouse_id' => $w, 'variant_id' => $variantId, 'on_hand' => '0', 'version' => 0, 'updated_at' => $now,
        ])->all());
    }

    /** Crea los saldos en cero de un depósito nuevo para todas las variantes del comercio. */
    public function initWarehouse(string $warehouseId): void
    {
        $now = Carbon::now()->format('Y-m-d H:i:s.u');
        ProductVariant::query()->select('id')->orderBy('id')->chunk(1000, function ($chunk) use ($warehouseId, $now) {
            StockLevel::insertForTenant($chunk->map(fn ($v) => [
                'id' => (string) Str::uuid7(), 'warehouse_id' => $warehouseId, 'variant_id' => $v->id, 'on_hand' => '0', 'version' => 0, 'updated_at' => $now,
            ])->all());
        });
    }

    /**
     * Bloquea los saldos en orden (depósito, variante). Si falta alguno (no debería: se crean
     * con la variante y con el depósito), lo crea en cero antes de bloquear.
     *
     * @param  list<string>  $warehouseIds
     * @param  list<string>  $variantIds
     * @return array<string, StockLevel> por "depósito|variante"
     */
    private function lockLevels(array $warehouseIds, array $variantIds): array
    {
        $fetch = fn () => StockLevel::whereIn('warehouse_id', $warehouseIds)->whereIn('variant_id', $variantIds)
            ->orderBy('warehouse_id')->orderBy('variant_id')->lockForUpdate()->get()
            ->keyBy(fn (StockLevel $l) => "{$l->warehouse_id}|{$l->variant_id}");
        $levels = $fetch();
        $missing = [];
        foreach ($warehouseIds as $w) {
            foreach ($variantIds as $v) {
                if (! $levels->has("{$w}|{$v}")) {
                    $missing[] = ['id' => (string) Str::uuid7(), 'warehouse_id' => $w, 'variant_id' => $v, 'on_hand' => '0', 'version' => 0, 'updated_at' => Carbon::now()->format('Y-m-d H:i:s.u')];
                }
            }
        }
        if ($missing !== []) {
            StockLevel::insertForTenant($missing);
            $levels = $fetch();
        }

        return $levels->all();
    }
}
