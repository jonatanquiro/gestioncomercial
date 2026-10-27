<?php

namespace App\Http\Controllers;

use App\Models\CashShift;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\SettlementItem;
use App\Models\StockLevel;
use App\Services\CashService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/** Resumen del día para el inicio. Cada bloque se arma solo si el usuario puede verlo. */
class DashboardController extends Controller
{
    public function __construct(private readonly CashService $cash) {}

    public function today(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $day = Carbon::now('America/Buenos_Aires')->startOfDay();
        $from = $day->copy()->utc();
        $to = $day->copy()->addDay()->utc();
        $out = ['date' => $day->toDateString()];

        if ($actor->can('sales.read_all') || $actor->can('sales.read_own')) {
            $all = $actor->can('sales.read_all');
            $sales = Sale::where('status', 'confirmed')->where('confirmed_at', '>=', $from)->where('confirmed_at', '<', $to)
                ->when(! $all, fn ($w) => $w->where('cashier_id', $actor->userId));
            $byKind = SalePayment::whereIn('sale_id', (clone $sales)->select('id'))->groupBy('kind')->selectRaw('kind, SUM(amount) AS total')->pluck('total', 'kind');
            $electronic = Money::of('0');
            foreach ($byKind as $kind => $amount) {
                if ($kind !== 'cash') {
                    $electronic = $electronic->plus((string) $amount);
                }
            }
            $out['sales'] = [
                'scope' => $all ? 'all' : 'own',
                'count' => (clone $sales)->count(),
                'total' => Money::round((string) ((clone $sales)->selectRaw('SUM(total) AS total')->value('total') ?? '0')),
                'cash' => Money::round((string) ($byKind['cash'] ?? '0')),
                'electronic' => Money::round($electronic),
            ];
        }

        if ($actor->can('cash.read_all')) {
            $shifts = CashShift::where('status', 'open')->get();
            $expected = Money::of('0');
            foreach ($shifts as $shift) {
                $expected = $expected->plus($this->cash->expectedCash($shift));
            }
            $unsettled = SalePayment::where('kind', '!=', 'cash')
                ->whereNotIn('id', SettlementItem::whereNotNull('sale_payment_id')->select('sale_payment_id'))
                ->whereIn('sale_id', Sale::where('status', 'confirmed')->select('id'));
            $out['cash'] = ['openShifts' => $shifts->count(), 'expected' => Money::round($expected)];
            $out['payments'] = [
                'unsettledCount' => (clone $unsettled)->count(),
                'unsettledAmount' => Money::round((string) ((clone $unsettled)->selectRaw('SUM(amount) AS total')->value('total') ?? '0')),
                'missingReference' => (clone $unsettled)->whereNull('reference')->count(),
            ];
        }

        if ($actor->can('stock.read')) {
            $products = Product::where('status', 'active')->where('track_stock', true)->whereNotNull('min_stock')->get(['id', 'name', 'min_stock'])->keyBy('id');
            $variants = ProductVariant::whereIn('product_id', $products->keys())->pluck('product_id', 'id');
            $onHand = StockLevel::whereIn('variant_id', $variants->keys())->groupBy('variant_id')->selectRaw('variant_id, SUM(on_hand) AS total')->pluck('total', 'variant_id');
            $low = $variants->filter(fn ($productId, $variantId) => Money::of((string) ($onHand[$variantId] ?? '0'))->isLessThanOrEqualTo($products[$productId]->min_stock))
                ->map(fn ($productId) => $products[$productId]->name)->sort()->values();
            $out['stock'] = ['lowCount' => $low->count(), 'lowNames' => $low->take(5)->all()];
        }

        return $this->json($out);
    }
}
