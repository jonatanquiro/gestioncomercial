<?php

namespace App\Services;

use App\Models\Promotion;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Support\Carbon;

/**
 * Promociones (ADR 0020). Cada línea recibe a lo sumo una promoción: la que más le descuenta.
 * Una línea con descuento manual no recibe promociones, para no acumular descuentos, y una
 * línea con porcentaje no suma unidades a un N×M.
 *
 * - percent: descuenta el porcentaje del importe de la línea.
 * - nxm: de cada N unidades elegibles (sumando todas las líneas que entran) se pagan M; las que
 *   no se pagan son las más baratas.
 */
class PromotionService
{
    public function __construct(private readonly EntitlementsService $entitlements) {}

    /** Promociones activas hoy, si el plan las incluye. */
    public function active()
    {
        if (! in_array('promotions', $this->entitlements->plan()['features'] ?? [], true)) {
            return collect();
        }
        $today = Carbon::now('America/Buenos_Aires')->toDateString();

        return Promotion::where('status', 'active')
            ->where(fn ($q) => $q->whereNull('starts_on')->orWhere('starts_on', '<=', $today))
            ->where(fn ($q) => $q->whereNull('ends_on')->orWhere('ends_on', '>=', $today))
            ->orderBy('created_at')->get();
    }

    /**
     * @param  list<array{productId: string, categoryId: ?string, saleMode: string, quantity: string, unitPrice: string, discountPercent: string, total: BigDecimal}>  $lines
     * @return list<?array{promotion: Promotion, amount: BigDecimal}> una entrada por línea
     */
    public function apply(array $lines): array
    {
        $best = array_fill(0, count($lines), null);
        // Primero los porcentajes; el N×M cuenta solo las líneas que no tienen ya un porcentaje,
        // así una misma unidad no da dos beneficios.
        foreach ($this->active()->sortBy(fn ($p) => $p->kind === 'percent' ? 0 : 1) as $promotion) {
            $eligible = array_keys(array_filter($lines, fn ($l, $i) => BigDecimal::of($l['discountPercent'])->isZero() && $this->matches($promotion, $l)
                && ($promotion->kind === 'percent' || $best[$i] === null || $best[$i]['promotion']->kind !== 'percent'), ARRAY_FILTER_USE_BOTH));
            if ($eligible === []) {
                continue;
            }
            $amounts = $promotion->kind === 'percent' ? $this->percent($promotion, $lines, $eligible) : $this->nxm($promotion, $lines, $eligible);
            foreach ($amounts as $i => $amount) {
                if ($amount->isPositive() && ($best[$i] === null || $amount->isGreaterThan($best[$i]['amount']))) {
                    $best[$i] = ['promotion' => $promotion, 'amount' => $amount];
                }
            }
        }

        return $best;
    }

    private function matches(Promotion $p, array $line): bool
    {
        return match ($p->scope) {
            'product' => $p->product_id === $line['productId'],
            'category' => $line['categoryId'] !== null && $p->category_id === $line['categoryId'],
            default => true,
        };
    }

    /** @return array<int, BigDecimal> */
    private function percent(Promotion $p, array $lines, array $eligible): array
    {
        $out = [];
        foreach ($eligible as $i) {
            $out[$i] = $lines[$i]['total']->multipliedBy($p->percent)->dividedBy(100, 2, RoundingMode::HALF_UP);
        }

        return $out;
    }

    /** @return array<int, BigDecimal> */
    private function nxm(Promotion $p, array $lines, array $eligible): array
    {
        // Solo unidades enteras de artículos por unidad: «lleva 3, paga 2» no aplica a kilos.
        $units = [];
        foreach ($eligible as $i) {
            $qty = BigDecimal::of($lines[$i]['quantity']);
            if ($lines[$i]['saleMode'] !== 'unit' || $qty->hasNonZeroFractionalPart()) {
                continue;
            }
            for ($n = 0; $n < $qty->toInt(); $n++) {
                $units[] = ['line' => $i, 'price' => BigDecimal::of($lines[$i]['unitPrice'])];
            }
        }
        $free = intdiv(count($units), (int) $p->buy_quantity) * ((int) $p->buy_quantity - (int) $p->pay_quantity);
        if ($free === 0) {
            return [];
        }
        usort($units, fn ($a, $b) => $a['price']->compareTo($b['price']));
        $out = [];
        foreach (array_slice($units, 0, $free) as $u) {
            $out[$u['line']] = ($out[$u['line']] ?? BigDecimal::zero())->plus($u['price']);
        }

        return array_map(fn ($a) => BigDecimal::of(Money::round($a)), $out);
    }
}
