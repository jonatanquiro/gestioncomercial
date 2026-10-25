<?php

namespace App\Services;

use App\Models\ProductVariant;
use App\Models\VariantCost;
use App\Models\VariantPrice;
use Brick\Math\BigDecimal;
use Illuminate\Support\Carbon;

/**
 * Precio y costo vigentes de una variante con su historial. El vigente vive en la variante
 * (lectura rápida para listados y el POS) y cada cambio cierra el período anterior y abre uno
 * nuevo en la misma transacción.
 */
class ProductService
{
    /** @return bool si el precio cambió */
    public function setPrice(ProductVariant $variant, string $price, string $userId, ?string $batchId = null, bool $initial = false): bool
    {
        if (! $initial && BigDecimal::of($variant->price)->isEqualTo($price)) {
            return false;
        }
        $now = Carbon::now();
        VariantPrice::where('variant_id', $variant->id)->where('is_current', true)->update(['is_current' => false, 'valid_to' => $now]);
        VariantPrice::create([
            'variant_id' => $variant->id, 'price' => $price, 'valid_from' => $now, 'is_current' => true,
            'changed_by' => $userId, 'batch_id' => $batchId,
        ]);
        $variant->forceFill(['price' => $price])->save();

        return true;
    }

    /** @return bool si el costo cambió */
    public function setCost(ProductVariant $variant, ?string $cost, string $source, string $userId, bool $initial = false): bool
    {
        $same = $variant->cost === null ? $cost === null : ($cost !== null && BigDecimal::of($variant->cost)->isEqualTo($cost));
        if (! $initial && $same) {
            return false;
        }
        if ($cost !== null) {
            VariantCost::create(['variant_id' => $variant->id, 'cost' => $cost, 'source' => $source, 'changed_by' => $userId, 'at' => Carbon::now()]);
        }
        $variant->forceFill(['cost' => $cost])->save();

        return true;
    }
}
