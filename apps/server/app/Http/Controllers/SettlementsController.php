<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\PaymentMethod;
use App\Models\Register;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\Settlement;
use App\Models\SettlementItem;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AuditService;
use App\Services\SettlementCsv;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SettlementsController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(): JsonResponse
    {
        $methods = PaymentMethod::pluck('name', 'id');

        return $this->json(Settlement::orderByDesc('created_at')->limit(100)->get()->map(fn ($s) => [
            'id' => $s->id, 'provider' => $s->provider, 'methodName' => $methods[$s->payment_method_id] ?? '',
            'fromDate' => $s->from_date, 'toDate' => $s->to_date, 'status' => $s->status,
        ])->all());
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'paymentMethodId' => ['required', 'uuid'], 'provider' => ['required', 'string', 'max:80'],
            'fromDate' => ['required', 'date_format:Y-m-d'], 'toDate' => ['required', 'date_format:Y-m-d', 'after_or_equal:fromDate'],
        ]);
        $id = DB::transaction(function () use ($actor, $v) {
            Tenant::whereKey($actor->tenantId)->lockForUpdate()->firstOrFail();
            $method = PaymentMethod::find($v['paymentMethodId']) ?? throw AppError::notFound('Medio de pago');
            if ($method->kind === 'cash') {
                throw AppError::badRequest('CASH_SETTLEMENT', 'El efectivo se controla con el arqueo de caja');
            }
            if (Settlement::where('payment_method_id', $method->id)->where('status', 'open')->where('from_date', '<=', $v['toDate'])->where('to_date', '>=', $v['fromDate'])->exists()) {
                throw AppError::conflict('SETTLEMENT_OVERLAP', 'Ya hay una rendición abierta de esa cuenta que incluye estas fechas');
            }
            $from = Carbon::createFromFormat('!Y-m-d', $v['fromDate'], 'America/Buenos_Aires')->utc();
            $to = Carbon::createFromFormat('!Y-m-d', $v['toDate'], 'America/Buenos_Aires')->addDay()->utc();
            $payments = SalePayment::where('payment_method_id', $method->id)->whereNotIn('id', SettlementItem::whereNotNull('sale_payment_id')->select('sale_payment_id'))->whereIn('sale_id', Sale::where('status', 'confirmed')->where('confirmed_at', '>=', $from)->where('confirmed_at', '<', $to)->select('id'))->get();
            if ($payments->count() > 2000) {
                throw AppError::badRequest('SETTLEMENT_LIMIT', 'Acotá las fechas: hasta 2000 cobros por rendición');
            }
            $s = Settlement::create(['payment_method_id' => $method->id, 'provider' => $v['provider'], 'from_date' => $v['fromDate'], 'to_date' => $v['toDate'], 'created_by' => $actor->userId]);
            foreach ($payments as $p) {
                SettlementItem::create(['settlement_id' => $s->id, 'sale_payment_id' => $p->id, 'reference' => $p->reference, 'expected' => $p->amount]);
            }
            $this->record($actor, $s->id, 'settlement.created', ['provider' => $v['provider'], 'payments' => $payments->count(), 'from' => $v['fromDate'], 'to' => $v['toDate']]);

            return $s->id;
        });

        return $this->json($this->dto($id), 201);
    }

    public function show(string $id): JsonResponse
    {
        return $this->json($this->dto($id));
    }

    public function refresh(Request $request, string $id): JsonResponse
    {
        Settlement::find($id) ?? throw AppError::notFound('Rendición');
        $actor = $this->actor($request);
        DB::transaction(function () use ($actor, $id) {
            Tenant::whereKey($actor->tenantId)->lockForUpdate()->firstOrFail();
            $s = $this->open($id);
            $from = Carbon::createFromFormat('!Y-m-d', $s->from_date, 'America/Buenos_Aires')->utc();
            $to = Carbon::createFromFormat('!Y-m-d', $s->to_date, 'America/Buenos_Aires')->addDay()->utc();
            $existing = SettlementItem::where('settlement_id', $id)->whereNotNull('sale_payment_id')->pluck('sale_payment_id');
            $payments = SalePayment::where('payment_method_id', $s->payment_method_id)->whereNotIn('id', SettlementItem::whereNotNull('sale_payment_id')->select('sale_payment_id'))->whereIn('sale_id', Sale::where('status', 'confirmed')->where('confirmed_at', '>=', $from)->where('confirmed_at', '<', $to)->select('id'))->get();
            if ($existing->count() + $payments->count() > 2000) {
                throw AppError::badRequest('SETTLEMENT_LIMIT', 'Hasta 2000 cobros por rendición');
            }
            foreach ($payments as $p) {
                SettlementItem::create(['settlement_id' => $id, 'sale_payment_id' => $p->id, 'reference' => $p->reference, 'expected' => $p->amount]);
            }
            $this->record($actor, $id, 'settlement.refreshed', ['added' => $payments->count()]);
        });

        return $this->json($this->dto($id));
    }

    public function import(Request $request, string $id): JsonResponse
    {
        Settlement::find($id) ?? throw AppError::notFound('Rendición');
        $v = Input::validate($this->body($request), [
            'csv' => ['required', 'string', 'max:2000000'], 'delimiter' => ['required', Rule::in([';', ','])],
            'decimal' => ['required', Rule::in(['.', ','])], 'columns' => ['required', 'array'],
            'columns.reference' => ['required', 'integer', 'min:0'], 'columns.gross' => ['required', 'integer', 'min:0'],
            'columns.fees' => ['nullable', 'integer', 'min:0'], 'columns.net' => ['nullable', 'integer', 'min:0'], 'columns.date' => ['nullable', 'integer', 'min:0'],
        ]);
        // Se usan reglas explícitas: Laravel separa los valores de "in" por comas.
        if (! in_array($v['delimiter'], [';', ','], true) || ! in_array($v['decimal'], ['.', ','], true)) {
            throw AppError::badRequest('CSV_FORMAT', 'Formato de archivo inválido');
        }
        $rows = app(SettlementCsv::class)->parse($v['csv'], $v['delimiter'], $v['decimal'], $v['columns']);
        $actor = $this->actor($request);
        DB::transaction(function () use ($id, $rows, $actor) {
            Tenant::whereKey($actor->tenantId)->lockForUpdate()->firstOrFail();
            $s = $this->open($id);
            $items = SettlementItem::where('settlement_id', $id)->lockForUpdate()->get();
            $seen = SettlementItem::whereIn('settlement_id', Settlement::where('payment_method_id', $s->payment_method_id)->select('id'))->whereNotNull('external_id')->pluck('external_id')->flip();
            foreach ($rows as $row) {
                if (isset($seen[$row['external_id']])) {
                    throw AppError::conflict('IMPORT_DUPLICATE', 'Ese reporte contiene una operación ya importada. No se agregó ninguna fila.');
                }
                $candidates = $items->filter(fn ($i) => $i->sale_payment_id && $i->status === 'pending' && $i->external_id === null && $i->reference === $row['external_id']);
                $item = $candidates->count() === 1 ? $candidates->first() : null;
                $status = $item && Money::of($item->expected)->isEqualTo($row['gross']) ? 'confirmed' : 'pending';
                $values = [...$row, 'status' => $status, 'source' => 'csv', 'reviewed_by' => $status === 'confirmed' ? $actor->userId : null, 'reviewed_at' => $status === 'confirmed' ? now() : null];
                if ($item) {
                    $item->forceFill($values)->save();
                } else {
                    SettlementItem::create(['settlement_id' => $id, ...$values]);
                }
            }
            $this->record($actor, $id, 'settlement.imported', ['rows' => count($rows)]);
        });

        return $this->json($this->dto($id));
    }

    public function review(Request $request, string $id): JsonResponse
    {
        Settlement::find($id) ?? throw AppError::notFound('Rendición');
        $v = Input::validate($this->body($request), [
            'itemId' => ['required', 'uuid'], 'status' => ['required', 'in:confirmed,observed,pending'],
            'gross' => ['nullable', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'fees' => ['nullable', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'net' => ['nullable', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'creditedOn' => ['nullable', 'date_format:Y-m-d'], 'notes' => ['required', 'string', 'max:500'],
        ]);
        $actor = $this->actor($request);
        DB::transaction(function () use ($id, $v, $actor) {
            $this->open($id);
            $item = SettlementItem::where('settlement_id', $id)->whereKey($v['itemId'])->lockForUpdate()->first() ?? throw AppError::notFound('Movimiento');
            $before = $item->only(['status', 'gross', 'fees', 'net', 'notes']);
            if ($v['status'] === 'confirmed') {
                if (! $item->sale_payment_id || ! isset($v['gross'], $v['fees'], $v['net']) || ! Money::of($v['gross'])->isEqualTo($item->expected) || ! Money::of($v['gross'])->minus($v['fees'])->isEqualTo($v['net'])) {
                    throw AppError::badRequest('SETTLEMENT_DIFFERENCE', 'Para confirmar, vinculá una venta y verificá bruto, deducciones y neto. Si hay diferencias, marcá Observado.');
                }
            }
            $item->forceFill(['status' => $v['status'], 'gross' => $v['gross'] ?? null, 'fees' => $v['fees'] ?? null, 'net' => $v['net'] ?? null, 'credited_on' => $v['creditedOn'] ?? null, 'notes' => $v['notes'], 'reviewed_by' => $actor->userId, 'reviewed_at' => now()])->save();
            $this->record($actor, $id, 'settlement.reviewed', ['itemId' => $item->id, 'before' => $before, 'after' => $item->only(['status', 'gross', 'fees', 'net', 'notes'])]);
        });

        return $this->json($this->dto($id));
    }

    public function match(Request $request, string $id): JsonResponse
    {
        Settlement::find($id) ?? throw AppError::notFound('Rendición');
        $v = Input::validate($this->body($request), ['reportItemId' => ['required', 'uuid'], 'saleItemId' => ['required', 'uuid'], 'notes' => ['required', 'string', 'max:500']]);
        $actor = $this->actor($request);
        DB::transaction(function () use ($id, $v, $actor) {
            $this->open($id);
            $report = SettlementItem::where('settlement_id', $id)->whereKey($v['reportItemId'])->lockForUpdate()->first() ?? throw AppError::notFound('Movimiento');
            $sale = SettlementItem::where('settlement_id', $id)->whereKey($v['saleItemId'])->lockForUpdate()->first() ?? throw AppError::notFound('Cobro');
            if ($report->sale_payment_id || ! $report->external_id || ! $sale->sale_payment_id || $sale->external_id || $sale->status !== 'pending') {
                throw AppError::conflict('MATCH_INVALID', 'Elegí un movimiento del reporte y un cobro pendiente sin vincular');
            }
            $values = $report->only(['external_id', 'gross', 'fees', 'net', 'credited_on']);
            $report->delete();
            $sale->forceFill([...$values, 'source' => 'csv', 'notes' => $v['notes'], 'status' => Money::of($sale->expected)->isEqualTo($values['gross']) ? 'confirmed' : 'observed', 'reviewed_by' => $actor->userId, 'reviewed_at' => now()])->save();
            $this->record($actor, $id, 'settlement.matched', ['reportItemId' => $v['reportItemId'], 'saleItemId' => $sale->id, 'operation' => $values['external_id'], 'notes' => $v['notes']]);
        });

        return $this->json($this->dto($id));
    }

    public function close(Request $request, string $id): JsonResponse
    {
        Settlement::find($id) ?? throw AppError::notFound('Rendición');
        $v = Input::validate($this->body($request), ['notes' => ['required', 'string', 'max:1000']]);
        $actor = $this->actor($request);
        DB::transaction(function () use ($id, $v, $actor) {
            Tenant::whereKey($actor->tenantId)->lockForUpdate()->firstOrFail();
            $s = $this->open($id);
            $items = SettlementItem::where('settlement_id', $id)->get();
            if ($items->isEmpty() || $items->contains('status', 'pending')) {
                throw AppError::conflict('SETTLEMENT_PENDING', 'Revisá todos los movimientos antes de cerrar; los que no puedas conciliar deben quedar observados con motivo');
            }
            $from = Carbon::createFromFormat('!Y-m-d', $s->from_date, 'America/Buenos_Aires')->utc();
            $to = Carbon::createFromFormat('!Y-m-d', $s->to_date, 'America/Buenos_Aires')->addDay()->utc();
            if (SalePayment::where('payment_method_id', $s->payment_method_id)->whereNotIn('id', SettlementItem::whereNotNull('sale_payment_id')->select('sale_payment_id'))->whereIn('sale_id', Sale::where('status', 'confirmed')->where('confirmed_at', '>=', $from)->where('confirmed_at', '<', $to)->select('id'))->exists()) {
                throw AppError::conflict('SETTLEMENT_NEW_SALES', 'Se registraron nuevos cobros en el período. Actualizá los cobros antes de cerrar.');
            }
            foreach ($this->dto($id)['items'] as $item) {
                if ($item['saleChanged'] && $item['status'] !== 'observed') {
                    throw AppError::conflict('SALE_CHANGED', 'Hay ventas anuladas o con devoluciones. Revisalas y dejá registrada la observación antes de cerrar.');
                }
            }
            $s->forceFill(['status' => 'closed', 'closed_by' => $actor->userId, 'closed_at' => now(), 'closing_notes' => $v['notes']])->save();
            $this->record($actor, $id, 'settlement.closed', ['notes' => $v['notes'], 'totals' => $this->dto($id)['totals']]);
        });

        return $this->json($this->dto($id));
    }

    private function open(string $id): Settlement
    {
        $s = Settlement::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Rendición');
        if ($s->status !== 'open') {
            throw AppError::conflict('SETTLEMENT_CLOSED', 'La rendición está cerrada y no se puede modificar');
        }

        return $s;
    }

    private function dto(string $id): array
    {
        $s = Settlement::find($id) ?? throw AppError::notFound('Rendición');
        $items = SettlementItem::where('settlement_id', $id)->orderBy('created_at')->get();
        $payments = SalePayment::whereIn('id', $items->pluck('sale_payment_id')->filter())->get()->keyBy('id');
        $sales = Sale::whereIn('id', $payments->pluck('sale_id'))->get()->keyBy('id');
        $returned = SaleReturn::whereIn('sale_id', $sales->keys())->pluck('sale_id')->flip();
        $users = User::whereIn('id', $sales->pluck('cashier_id')->merge($items->pluck('reviewed_by'))->push($s->closed_by)->filter())->pluck('name', 'id');
        $registers = Register::whereIn('id', $sales->pluck('register_id'))->pluck('name', 'id');
        $totals = [];
        foreach (['expected', 'gross', 'fees', 'net'] as $field) {
            $sum = Money::of('0');
            foreach ($items as $item) {
                $sum = $sum->plus($item->$field ?? '0');
            }
            $totals[$field] = Money::round($sum);
        }

        return [
            'id' => $s->id, 'provider' => $s->provider, 'methodName' => PaymentMethod::find($s->payment_method_id)?->name,
            'fromDate' => $s->from_date, 'toDate' => $s->to_date, 'status' => $s->status, 'totals' => $totals,
            'closedAt' => Dates::iso($s->closed_at), 'closedBy' => $users[$s->closed_by] ?? null, 'closingNotes' => $s->closing_notes,
            'items' => $items->map(function ($i) use ($payments, $sales, $returned, $users, $registers) {
                $sale = $sales[$payments[$i->sale_payment_id]->sale_id ?? ''] ?? null;

                return ['id' => $i->id, 'saleId' => $sale?->id, 'saleNumber' => $sale?->number, 'reference' => $i->reference, 'externalId' => $i->external_id,
                    'expected' => $i->expected, 'gross' => $i->gross, 'fees' => $i->fees, 'net' => $i->net, 'creditedOn' => $i->credited_on,
                    'status' => $i->status, 'source' => $i->source, 'notes' => $i->notes, 'reviewedBy' => $users[$i->reviewed_by] ?? null,
                    'cashierName' => $users[$sale?->cashier_id] ?? '', 'registerName' => $registers[$sale?->register_id] ?? '',
                    'saleChanged' => $sale && ($sale->status !== 'confirmed' || isset($returned[$sale->id])),
                ];
            })->all(),
        ];
    }

    private function record(Actor $actor, string $id, string $action, array $after): void
    {
        $this->audit->record(['tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName, 'action' => $action, 'entityType' => 'settlement', 'entityId' => $id, 'after' => $after, 'ip' => $actor->ip, 'requestId' => $actor->requestId]);
    }
}
