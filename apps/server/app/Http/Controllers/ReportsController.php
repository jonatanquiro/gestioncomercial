<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Category;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Models\SaleLine;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\StockLevel;
use App\Models\User;
use App\Services\EntitlementsService;
use App\Support\AppError;
use App\Support\Input;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Reportes (ADR 0019): ventas de un período agrupadas, y mercadería sin rotación. Cuentan las
 * ventas de mercadería confirmadas, netas de devoluciones (por la fecha de la venta). La venta
 * de gift cards y los cobros de cuenta corriente no son ventas de mercadería: no entran.
 */
class ReportsController extends Controller
{
    private const TZ = 'America/Buenos_Aires';

    public function __construct(private readonly EntitlementsService $entitlements) {}

    public function sales(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $q = Input::validate($request->query(), [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'branchId' => ['nullable', 'uuid'],
            'groupBy' => ['required', 'in:day,product,variant,category,cashier,payment'],
        ], ['to.after_or_equal' => 'La fecha final no puede ser anterior a la inicial']);
        $from = Carbon::parse($q['from'], self::TZ)->startOfDay();
        $to = Carbon::parse($q['to'], self::TZ)->endOfDay();
        if ($from->diffInDays($to) > 366) {
            throw AppError::validation([['path' => 'to', 'message' => 'El período puede ser de hasta un año']]);
        }
        $profit = $this->canSeeProfit($actor);
        $sales = Sale::where('status', 'confirmed')->where('kind', 'sale')
            ->where('confirmed_at', '>=', $from->copy()->utc())->where('confirmed_at', '<=', $to->copy()->utc())
            ->when($q['branchId'] ?? null, fn ($w, $id) => $w->where('branch_id', $id));

        $lines = $this->linesByVariant(clone $sales);
        $summary = $this->summary(clone $sales, $lines, $profit);
        $rows = match ($q['groupBy']) {
            'day' => $this->byDay(clone $sales),
            'variant' => $this->byVariant($lines),
            'product' => $this->byProduct($lines),
            'category' => $this->byCategory($lines),
            'cashier' => $this->byCashier(clone $sales),
            'payment' => $this->byPayment(clone $sales),
        };
        if (! $profit) {
            $rows = array_map(fn ($r) => array_diff_key($r, ['cost' => 1, 'margin' => 1, 'missingCost' => 1]), $rows);
        }

        return $this->json(['summary' => $summary, 'rows' => $rows, 'profit' => $profit]);
    }

    /** Lo que tiene stock y no se vendió en los últimos días: candidatos a liquidar. */
    public function stale(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $q = Input::validate($request->query(), ['days' => ['required', 'integer', 'min:7', 'max:365']]);
        $since = Carbon::now(self::TZ)->subDays((int) $q['days'])->utc();
        $stock = StockLevel::groupBy('variant_id')->selectRaw('variant_id, SUM(on_hand) AS total')->havingRaw('SUM(on_hand) > 0')->pluck('total', 'variant_id');
        $sold = SaleLine::whereIn('sale_id', Sale::where('status', 'confirmed')->where('confirmed_at', '>=', $since)->select('id'))->distinct()->pluck('variant_id')->flip();
        $variants = ProductVariant::whereIn('id', $stock->keys()->reject(fn ($id) => isset($sold[$id]))->values())->where('status', 'active')->get();
        $products = Product::whereIn('id', $variants->pluck('product_id'))->where('status', 'active')->where('track_stock', true)->get()->keyBy('id');
        $lastSale = SaleLine::whereIn('variant_id', $variants->pluck('id'))
            ->whereIn('sale_id', Sale::where('status', 'confirmed')->select('id'))
            ->join('sales', 'sales.id', '=', 'sale_lines.sale_id')
            ->groupBy('sale_lines.variant_id')->selectRaw('sale_lines.variant_id, MAX(sales.confirmed_at) AS last')->pluck('last', 'variant_id');
        $profit = $this->canSeeProfit($actor);
        $rows = $variants->filter(fn ($v) => isset($products[$v->product_id]))->map(fn (ProductVariant $v) => [
            'variantId' => $v->id,
            'productId' => $v->product_id,
            'name' => ProductVariant::displayName($products[$v->product_id]->name, $v->label),
            'stock' => Money::quantity((string) $stock[$v->id]),
            'lastSaleAt' => isset($lastSale[$v->id]) ? Carbon::parse($lastSale[$v->id], 'UTC')->toIso8601String() : null,
            'stockValue' => $profit && $v->cost !== null ? Money::round(Money::of((string) $stock[$v->id])->multipliedBy($v->cost)) : null,
        ])->sortBy('name')->values()->all();

        return $this->json(['rows' => $rows, 'profit' => $profit]);
    }

    /** Margen y ganancia: con el permiso y con el plan que incluye reportes avanzados. */
    private function canSeeProfit(Actor $actor): bool
    {
        return $actor->can('reports.profit') && in_array('advanced_reports', $this->entitlements->plan()['features'] ?? [], true);
    }

    /** Totales por variante, netos de devoluciones: cantidad, importe y costo de lo que quedó vendido. */
    private function linesByVariant($sales)
    {
        return SaleLine::whereIn('sale_id', $sales->select('id'))
            ->groupBy('variant_id')
            ->selectRaw('variant_id,
                SUM(quantity - returned_quantity) AS qty,
                SUM(line_total) AS gross,
                SUM(line_total - COALESCE((SELECT SUM(r.amount) FROM sale_return_lines r WHERE r.sale_line_id = sale_lines.id), 0)) AS net,
                SUM(CASE WHEN unit_cost IS NULL THEN 0 ELSE unit_cost * (quantity - returned_quantity) END) AS cost,
                SUM(CASE WHEN unit_cost IS NULL AND quantity > returned_quantity THEN 1 ELSE 0 END) AS missing_cost')
            ->get()->keyBy('variant_id');
    }

    private function summary($sales, $lines, bool $profit): array
    {
        $count = (clone $sales)->count();
        $gross = Money::of((string) ((clone $sales)->sum('total')));
        $returned = Money::of((string) SaleReturn::whereIn('sale_id', (clone $sales)->select('id'))->sum('total'));
        $net = $gross->minus($returned);
        $out = [
            'count' => $count,
            'gross' => Money::round($gross),
            'returns' => Money::round($returned),
            'net' => Money::round($net),
            'averageTicket' => $count > 0 ? Money::round($net->dividedBy($count, 2, RoundingMode::HALF_UP)) : '0.00',
            'units' => Money::quantity((string) $lines->sum('qty')),
        ];
        if ($profit) {
            $cost = Money::of((string) $lines->sum('cost'));
            $out += ['cost' => Money::round($cost), 'margin' => Money::round($net->minus($cost)), 'missingCost' => (int) $lines->sum('missing_cost')];
        }

        return $out;
    }

    private function row(string $key, string $label, $l, ?string $extra = null): array
    {
        $net = Money::of((string) $l['net']);
        $cost = Money::of((string) $l['cost']);

        return array_filter([
            'key' => $key, 'label' => $label, 'detail' => $extra,
            'quantity' => Money::quantity((string) $l['qty']), 'total' => Money::round($net),
            'cost' => Money::round($cost), 'margin' => Money::round($net->minus($cost)), 'missingCost' => (int) $l['missing_cost'],
        ], fn ($v) => $v !== null);
    }

    private function byVariant($lines): array
    {
        $variants = ProductVariant::whereIn('id', $lines->keys())->get()->keyBy('id');
        $products = Product::whereIn('id', $variants->pluck('product_id'))->get()->keyBy('id');
        $stock = StockLevel::whereIn('variant_id', $lines->keys())->groupBy('variant_id')->selectRaw('variant_id, SUM(on_hand) AS total')->pluck('total', 'variant_id');

        return $lines->map(function ($l, $id) use ($variants, $products, $stock) {
            $v = $variants[$id];
            $p = $products[$v->product_id];

            return $this->row($id, ProductVariant::displayName($p->name, $v->label), $l, $p->track_stock ? 'Stock actual: '.Money::plainQuantity((string) ($stock[$id] ?? '0')) : null);
        })->sortByDesc(fn ($r) => (float) $r['total'])->values()->all();
    }

    /** Suma las variantes de cada producto (o de cada categoría) con la misma forma de fila. */
    private function aggregate($lines, callable $keyOf): array
    {
        $groups = [];
        foreach ($lines as $id => $l) {
            $key = $keyOf($id);
            $groups[$key] ??= ['qty' => BigDecimal::zero(), 'net' => BigDecimal::zero(), 'cost' => BigDecimal::zero(), 'missing_cost' => 0];
            $groups[$key]['qty'] = $groups[$key]['qty']->plus((string) $l->qty);
            $groups[$key]['net'] = $groups[$key]['net']->plus((string) $l->net);
            $groups[$key]['cost'] = $groups[$key]['cost']->plus((string) $l->cost);
            $groups[$key]['missing_cost'] += (int) $l->missing_cost;
        }

        return $groups;
    }

    private function byProduct($lines): array
    {
        $variants = ProductVariant::whereIn('id', $lines->keys())->pluck('product_id', 'id');
        $groups = $this->aggregate($lines, fn ($id) => $variants[$id]);
        $products = Product::whereIn('id', array_keys($groups))->pluck('name', 'id');

        return collect($groups)->map(fn ($g, $id) => $this->row($id, $products[$id] ?? '', $g))->sortByDesc(fn ($r) => (float) $r['total'])->values()->all();
    }

    private function byCategory($lines): array
    {
        $variants = ProductVariant::whereIn('id', $lines->keys())->pluck('product_id', 'id');
        $productCategory = Product::whereIn('id', $variants->unique()->values())->pluck('category_id', 'id');
        $groups = $this->aggregate($lines, fn ($id) => $productCategory[$variants[$id]] ?? 'none');
        $names = Category::whereIn('id', array_keys($groups))->pluck('name', 'id');

        return collect($groups)->map(fn ($g, $id) => $this->row($id, $names[$id] ?? 'Sin categoría', $g))->sortByDesc(fn ($r) => (float) $r['total'])->values()->all();
    }

    /** Ventas, devoluciones y neto por día (hora de Argentina). */
    private function byDay($sales): array
    {
        $day = "DATE(CONVERT_TZ(confirmed_at, '+00:00', '-03:00'))";
        $totals = (clone $sales)->groupByRaw($day)->selectRaw("{$day} AS day, COUNT(*) AS n, SUM(total) AS total")->get()->keyBy('day');
        $returns = SaleReturn::whereIn('sale_id', (clone $sales)->select('id'))->get(['sale_id', 'total']);
        $saleDay = (clone $sales)->whereIn('id', $returns->pluck('sale_id'))->selectRaw("id, {$day} AS day")->pluck('day', 'id');
        $returnedByDay = [];
        foreach ($returns as $r) {
            $d = $saleDay[$r->sale_id];
            $returnedByDay[$d] = Money::of($returnedByDay[$d] ?? '0')->plus($r->total);
        }

        return $totals->map(fn ($t, $d) => [
            'key' => (string) $d, 'label' => (string) $d, 'count' => (int) $t->n,
            'total' => Money::round(Money::of((string) $t->total)->minus($returnedByDay[$d] ?? '0')),
        ])->sortBy('key')->values()->all();
    }

    private function byCashier($sales): array
    {
        $totals = (clone $sales)->groupBy('cashier_id')->selectRaw('cashier_id, COUNT(*) AS n, SUM(total) AS total')->get()->keyBy('cashier_id');
        $returns = SaleReturn::whereIn('sale_id', (clone $sales)->select('id'))->get(['sale_id', 'total']);
        $cashierOf = Sale::whereIn('id', $returns->pluck('sale_id'))->pluck('cashier_id', 'id');
        $returned = [];
        foreach ($returns as $r) {
            $c = $cashierOf[$r->sale_id];
            $returned[$c] = Money::of($returned[$c] ?? '0')->plus($r->total);
        }
        $names = User::whereIn('id', $totals->keys())->pluck('name', 'id');

        return $totals->map(fn ($t, $id) => [
            'key' => $id, 'label' => $names[$id] ?? '', 'count' => (int) $t->n,
            'total' => Money::round(Money::of((string) $t->total)->minus($returned[$id] ?? '0')),
        ])->sortByDesc(fn ($r) => (float) $r['total'])->values()->all();
    }

    /** Cómo se cobró lo vendido, ya descontado el vuelto. */
    private function byPayment($sales): array
    {
        $totals = SalePayment::whereIn('sale_id', (clone $sales)->select('id'))->groupBy('payment_method_id')->selectRaw('payment_method_id, COUNT(*) AS n, SUM(amount) AS total')->get();
        $names = PaymentMethod::whereIn('id', $totals->pluck('payment_method_id'))->pluck('name', 'id');

        return $totals->map(fn ($t) => [
            'key' => $t->payment_method_id, 'label' => $names[$t->payment_method_id] ?? '', 'count' => (int) $t->n, 'total' => Money::round((string) $t->total),
        ])->sortByDesc(fn ($r) => (float) $r['total'])->values()->all();
    }
}
