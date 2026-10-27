<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Branch;
use App\Models\PaymentMethod;
use App\Models\Register;
use App\Models\Sale;
use App\Models\SaleLine;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\SaleReturnLine;
use App\Models\User;
use App\Services\SalesService;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Ventas del punto de venta: cobro, historial, anulación y devolución (sección 7 del diseño). */
class SalesController extends Controller
{
    public function __construct(private readonly SalesService $sales) {}

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'registerId' => ['required', 'string', 'uuid'],
            'lines' => ['required', 'array', 'list', 'min:1', 'max:300'],
            'lines.*' => ['array'],
            'lines.*.variantId' => ['required', 'string', 'uuid', 'distinct'],
            'lines.*.quantity' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
            'lines.*.discountPercent' => ['nullable', ...Input::decimal(Input::PERCENT, 'Descuento inválido')],
            'payments' => ['present', 'array', 'list', 'max:10'],
            'payments.*' => ['array'],
            'payments.*.paymentMethodId' => ['required', 'string', 'uuid'],
            'payments.*.amount' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'payments.*.reference' => ['nullable', 'string', 'max:80'],
            'payments.*.payerName' => ['nullable', 'string', 'max:120'],
            'payments.*.payerPhone' => ['nullable', 'string', 'regex:/^[\d\s()+-]{6,30}$/'],
            'expectedTotal' => ['required', ...Input::decimal(Input::MONEY, 'Total inválido')],
            'authorization' => ['nullable', 'array'],
        ], ['payments.*.payerPhone.regex' => 'Teléfono inválido', 'lines.required' => 'Agregá al menos un artículo', 'lines.min' => 'Agregá al menos un artículo', 'lines.*.variantId.distinct' => 'El artículo está repetido']);
        $details = [];
        foreach ($input['lines'] as $i => $line) {
            if (Money::of($line['quantity'])->isZero()) {
                $details[] = ['path' => "lines.{$i}.quantity", 'message' => 'La cantidad no puede ser cero'];
            }
            if (Money::of($line['discountPercent'] ?? '0')->isGreaterThan(100)) {
                $details[] = ['path' => "lines.{$i}.discountPercent", 'message' => 'El descuento no puede superar el 100%'];
            }
        }
        foreach ($input['payments'] as $i => $p) {
            if (Money::of($p['amount'])->isZero()) {
                $details[] = ['path' => "payments.{$i}.amount", 'message' => 'El importe no puede ser cero'];
            }
        }
        if ($details !== []) {
            throw AppError::validation($details);
        }
        ['sale' => $sale, 'created' => $created] = $this->sales->create($actor, $input);

        return $this->json($this->dto($sale, $actor), $created ? 201 : 200);
    }

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'shiftId' => ['nullable', 'string', 'uuid'],
            'number' => ['nullable', 'integer', 'min:1'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
        ]);
        $query = $this->visible($actor)
            ->when($q['shiftId'] ?? null, fn ($w, $id) => $w->where('shift_id', $id))
            ->when($q['number'] ?? null, fn ($w, $n) => $w->where('number', (int) $n))
            ->when($q['from'] ?? null, fn ($w, $d) => $w->where('confirmed_at', '>=', "{$d} 00:00:00"))
            ->when($q['to'] ?? null, fn ($w, $d) => $w->where('confirmed_at', '<=', "{$d} 23:59:59.999999"));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('confirmed_at')->orderByDesc('id')->forPage($page, $pageSize)->get();
        $users = User::whereIn('id', $rows->pluck('cashier_id')->unique())->pluck('name', 'id');
        $registers = Register::whereIn('id', $rows->pluck('register_id')->unique())->pluck('name', 'id');
        $returned = SaleReturn::whereIn('sale_id', $rows->pluck('id'))->groupBy('sale_id')->selectRaw('sale_id, SUM(total) AS total')->pluck('total', 'sale_id');

        return $this->json([
            'items' => $rows->map(fn (Sale $s) => [
                'id' => $s->id,
                'number' => $s->number,
                'status' => $s->status,
                'confirmedAt' => Dates::iso($s->confirmed_at),
                'cashierName' => $users[$s->cashier_id] ?? '',
                'registerName' => $registers[$s->register_id] ?? '',
                'total' => Money::round($s->total),
                'returnedTotal' => Money::round((string) ($returned[$s->id] ?? '0')),
            ])->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $sale = $this->visible($actor)->whereKey($id)->first() ?? throw AppError::notFound('Venta');

        return $this->json($this->dto($sale, $actor));
    }

    public function void(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'reason' => ['required', 'string', 'max:200'],
            'authorization' => ['nullable', 'array'],
        ]);
        $this->visible($actor)->whereKey($id)->exists() || throw AppError::notFound('Venta');
        $sale = $this->sales->void($actor, $id, trim($input['reason']), $input['authorization'] ?? null);

        return $this->json($this->dto($sale, $actor));
    }

    public function storeReturn(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'registerId' => ['required', 'string', 'uuid'],
            'reason' => ['required', 'string', 'max:200'],
            'paymentMethodId' => ['required', 'string', 'uuid'],
            'lines' => ['required', 'array', 'list', 'min:1', 'max:300'],
            'lines.*' => ['array'],
            'lines.*.saleLineId' => ['required', 'string', 'uuid', 'distinct'],
            'lines.*.quantity' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
            'lines.*.restock' => ['present', Input::strictBoolean()],
            'authorization' => ['nullable', 'array'],
        ], ['lines.required' => 'Elegí qué se devuelve', 'lines.min' => 'Elegí qué se devuelve']);
        foreach ($input['lines'] as $i => $line) {
            if (Money::of($line['quantity'])->isZero()) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => 'La cantidad no puede ser cero']]);
            }
        }
        $this->visible($actor)->whereKey($id)->exists() || throw AppError::notFound('Venta');
        $input['reason'] = trim($input['reason']);
        ['created' => $created] = $this->sales->return($actor, $id, $input);

        return $this->json($this->dto(Sale::find($id), $actor), $created ? 201 : 200);
    }

    /** Sin sales.read_all, cada uno ve solo sus ventas. */
    private function visible(Actor $actor)
    {
        return Sale::query()->when(! $actor->can('sales.read_all'), fn ($w) => $w->where('cashier_id', $actor->userId));
    }

    /** Forma de SaleDto: lo necesario para el detalle y para imprimir el ticket. */
    private function dto(Sale $sale, Actor $actor): array
    {
        $lines = SaleLine::where('sale_id', $sale->id)->orderBy('line_no')->get();
        $payments = SalePayment::where('sale_id', $sale->id)->get();
        $returns = SaleReturn::where('sale_id', $sale->id)->orderBy('created_at')->get();
        $returnLines = SaleReturnLine::whereIn('return_id', $returns->pluck('id'))->get()->groupBy('return_id');
        $methods = PaymentMethod::whereIn('id', $payments->pluck('payment_method_id')->merge($returns->pluck('payment_method_id')))->pluck('name', 'id');
        $userIds = collect([$sale->cashier_id, $sale->voided_by, $sale->void_authorized_by, $sale->discount_authorized_by])
            ->merge($returns->pluck('user_id'))->merge($returns->pluck('authorized_by'))->filter()->unique();
        $users = User::whereIn('id', $userIds)->pluck('name', 'id');
        $register = Register::find($sale->register_id);
        $seeCost = $actor->can('costs.read');

        return [
            'id' => $sale->id,
            'number' => $sale->number,
            'status' => $sale->status,
            'confirmedAt' => Dates::iso($sale->confirmed_at),
            'branchName' => Branch::find($sale->branch_id)?->name ?? '',
            'registerId' => $sale->register_id,
            'registerName' => $register?->name ?? '',
            'shiftId' => $sale->shift_id,
            'cashierName' => $users[$sale->cashier_id] ?? '',
            'subtotal' => Money::round($sale->subtotal),
            'discountTotal' => Money::round($sale->discount_total),
            'total' => Money::round($sale->total),
            'changeGiven' => Money::round($sale->change_given),
            'discountAuthorizedBy' => $users[$sale->discount_authorized_by] ?? null,
            'lines' => $lines->map(fn (SaleLine $l) => [
                'id' => $l->id,
                'variantId' => $l->variant_id,
                'description' => $l->description,
                'saleMode' => $l->sale_mode,
                'quantity' => Money::quantity($l->quantity),
                'unitPrice' => Money::round($l->unit_price),
                'unitCost' => $seeCost && $l->unit_cost !== null ? Money::roundUnit($l->unit_cost) : null,
                'discountPercent' => Money::round($l->discount_percent),
                'discountAmount' => Money::round($l->discount_amount),
                'vatRate' => $l->vat_rate,
                'total' => Money::round($l->line_total),
                'returnedQuantity' => Money::quantity($l->returned_quantity),
            ])->all(),
            'payments' => $payments->map(fn (SalePayment $p) => [
                'paymentMethodId' => $p->payment_method_id,
                'name' => $methods[$p->payment_method_id] ?? '',
                'kind' => $p->kind,
                'amount' => Money::round($p->amount),
                'reference' => $p->reference,
                'payerName' => $p->payer_name,
                'payerPhone' => $p->payer_phone,
            ])->all(),
            'void' => $sale->status === 'voided' ? [
                'at' => Dates::iso($sale->voided_at),
                'byName' => $users[$sale->voided_by] ?? '',
                'authorizedByName' => $users[$sale->void_authorized_by] ?? null,
                'reason' => $sale->void_reason,
            ] : null,
            'returns' => $returns->map(fn (SaleReturn $r) => [
                'id' => $r->id,
                'number' => (int) $r->number,
                'createdAt' => Dates::iso($r->created_at),
                'total' => Money::round($r->total),
                'reason' => $r->reason,
                'paymentMethodName' => $methods[$r->payment_method_id] ?? '',
                'userName' => $users[$r->user_id] ?? '',
                'authorizedByName' => $users[$r->authorized_by] ?? null,
                'lines' => ($returnLines[$r->id] ?? collect())->map(fn (SaleReturnLine $l) => [
                    'saleLineId' => $l->sale_line_id, 'quantity' => Money::quantity($l->quantity), 'amount' => Money::round($l->amount), 'restock' => (bool) $l->restock,
                ])->values()->all(),
            ])->all(),
        ];
    }
}
