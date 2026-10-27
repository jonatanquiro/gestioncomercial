<?php

namespace App\Http\Controllers;

use App\Models\PaymentMethod;
use App\Models\Register;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\Settlement;
use App\Models\SettlementItem;
use App\Models\User;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Consulta de cobros que no son en efectivo (transferencias, QR y tarjetas), con su estado de
 * rendición y señales para revisar. No modifica nada: la verificación se hace en la rendición.
 */
class PaymentsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'kind' => ['nullable', Rule::in(['debit', 'credit', 'transfer', 'qr', 'other'])],
            'paymentMethodId' => ['nullable', 'string', 'uuid'],
            'registerId' => ['nullable', 'string', 'uuid'],
            'settlement' => ['nullable', Rule::in(['none', 'pending', 'confirmed', 'observed'])],
            'flag' => ['nullable', Rule::in(['duplicate', 'missing_reference', 'sale_changed'])],
            'q' => ['nullable', 'string', 'max:80'],
        ]);

        // Mismo criterio de fechas que la rendición: días de Argentina sobre la confirmación de la venta.
        $sales = Sale::query()
            ->when($q['from'] ?? null, fn ($w, $d) => $w->where('confirmed_at', '>=', Carbon::createFromFormat('!Y-m-d', $d, 'America/Buenos_Aires')->utc()))
            ->when($q['to'] ?? null, fn ($w, $d) => $w->where('confirmed_at', '<', Carbon::createFromFormat('!Y-m-d', $d, 'America/Buenos_Aires')->addDay()->utc()))
            ->when($q['registerId'] ?? null, fn ($w, $id) => $w->where('register_id', $id));
        $query = SalePayment::where('kind', '!=', 'cash')
            ->when($q['kind'] ?? null, fn ($w, $k) => $w->where('kind', $k))
            ->when($q['paymentMethodId'] ?? null, fn ($w, $id) => $w->where('payment_method_id', $id));
        if (isset($q['from']) || isset($q['to']) || isset($q['registerId'])) {
            $query->whereIn('sale_id', $sales->select('id'));
        }
        $settlement = $q['settlement'] ?? null;
        if ($settlement === 'none') {
            $query->whereNotIn('id', SettlementItem::whereNotNull('sale_payment_id')->select('sale_payment_id'));
        } elseif ($settlement) {
            $query->whereIn('id', SettlementItem::where('status', $settlement)->whereNotNull('sale_payment_id')->select('sale_payment_id'));
        }
        match ($q['flag'] ?? null) {
            'duplicate' => $query->whereRaw('(sale_payments.payment_method_id, sale_payments.reference) IN ('.$this->duplicates()->toSql().')', $this->duplicates()->getBindings()),
            'missing_reference' => $query->whereNull('reference'),
            'sale_changed' => $query->where(fn ($w) => $w->whereIn('sale_id', Sale::where('status', '!=', 'confirmed')->select('id'))->orWhereIn('sale_id', SaleReturn::select('sale_id'))),
            default => null,
        };
        $term = trim($q['q'] ?? '');
        if ($term !== '') {
            $query->where(function ($w) use ($term) {
                $w->where('reference', 'like', '%'.addcslashes($term, '%_\\').'%');
                if (preg_match('/^\d{1,18}$/', $term)) {
                    $w->orWhereIn('sale_id', Sale::where('number', (int) $term)->select('id'));
                }
                if (preg_match('/^\d{1,12}([.,]\d{1,2})?$/', $term)) {
                    $w->orWhere('amount', str_replace(',', '.', $term));
                }
            });
        }

        $total = (clone $query)->count();
        $sum = (clone $query)->selectRaw('SUM(amount) AS total')->value('total');
        $rows = $query->orderByDesc(Sale::select('confirmed_at')->whereColumn('sales.id', 'sale_payments.sale_id')->limit(1))->orderBy('id')->forPage($page, $pageSize)->get();

        $saleRows = Sale::whereIn('id', $rows->pluck('sale_id')->unique())->get()->keyBy('id');
        $returned = SaleReturn::whereIn('sale_id', $saleRows->keys())->pluck('sale_id')->flip();
        $users = User::whereIn('id', $saleRows->pluck('cashier_id')->unique())->pluck('name', 'id');
        $registers = Register::whereIn('id', $saleRows->pluck('register_id')->unique())->pluck('name', 'id');
        $methods = PaymentMethod::whereIn('id', $rows->pluck('payment_method_id')->unique())->pluck('name', 'id');
        $items = SettlementItem::whereIn('sale_payment_id', $rows->pluck('id'))->get()->keyBy('sale_payment_id');
        $settlements = Settlement::whereIn('id', $items->pluck('settlement_id')->unique())->get()->keyBy('id');
        $repeated = $this->duplicates()->whereIn('reference', $rows->pluck('reference')->filter()->unique())->get()
            ->map(fn ($d) => $d->payment_method_id.'|'.mb_strtolower($d->reference))->flip();

        return $this->json([
            'items' => $rows->map(function (SalePayment $p) use ($saleRows, $returned, $users, $registers, $methods, $items, $settlements, $repeated) {
                $sale = $saleRows[$p->sale_id];
                $item = $items[$p->id] ?? null;
                $s = $item ? $settlements[$item->settlement_id] : null;

                return [
                    'id' => $p->id, 'saleId' => $sale->id, 'saleNumber' => $sale->number, 'confirmedAt' => Dates::iso($sale->confirmed_at),
                    'registerName' => $registers[$sale->register_id] ?? '', 'cashierName' => $users[$sale->cashier_id] ?? '',
                    'paymentMethodId' => $p->payment_method_id, 'methodName' => $methods[$p->payment_method_id] ?? '', 'kind' => $p->kind,
                    'amount' => Money::round($p->amount), 'reference' => $p->reference,
                    'saleChanged' => $sale->status !== 'confirmed' || isset($returned[$sale->id]),
                    'duplicateReference' => $p->reference !== null && isset($repeated[$p->payment_method_id.'|'.mb_strtolower($p->reference)]),
                    'settlement' => $s ? ['id' => $s->id, 'provider' => $s->provider, 'status' => $s->status, 'itemStatus' => $item->status] : null,
                ];
            })->all(),
            'total' => $total,
            'totalAmount' => Money::round((string) ($sum ?? '0')),
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    /**
     * Pares (medio de pago, N° de operación) cargados en más de un cobro de ventas confirmadas.
     * Una venta anulada y vuelta a cobrar con la misma operación no cuenta como repetida.
     */
    private function duplicates()
    {
        return SalePayment::where('kind', '!=', 'cash')->whereNotNull('reference')
            ->whereIn('sale_id', Sale::where('status', 'confirmed')->select('id'))
            ->groupBy('payment_method_id', 'reference')->havingRaw('COUNT(*) > 1')
            ->select('payment_method_id', 'reference')->toBase();
    }
}
