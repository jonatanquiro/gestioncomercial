<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Customer;
use App\Models\CustomerMovement;
use App\Models\Sale;
use App\Models\User;
use App\Services\AuditService;
use App\Services\CustomerAccountService;
use App\Support\AppError;
use App\Support\Cuit;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Clientes y su cuenta corriente (ADR 0016). El cobro de la deuda está en SalesController. */
class CustomersController extends Controller
{
    public function __construct(
        private readonly CustomerAccountService $accounts,
        private readonly AuditService $audit,
    ) {}

    public function index(Request $request): JsonResponse
    {
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'q' => ['nullable', 'string', 'max:120'],
            'withDebt' => ['nullable', 'in:true,false'],
            'status' => ['nullable', 'in:active,inactive,all'],
        ]);
        $term = trim((string) ($q['q'] ?? ''));
        $digits = preg_replace('/\D/', '', $term);
        $query = Customer::query()
            ->when(($q['status'] ?? 'active') !== 'all', fn ($w) => $w->where('status', $q['status'] ?? 'active'))
            ->when($term !== '', fn ($w) => $w->where(fn ($x) => $x->where('name', 'like', '%'.$term.'%')
                ->when(strlen($digits) >= 3, fn ($y) => $y->orWhere('document_number', 'like', $digits.'%'))->orWhere('phone', 'like', '%'.$term.'%')))
            ->when(($q['withDebt'] ?? null) === 'true', fn ($w) => $w->where('balance', '>', 0));
        $total = (clone $query)->count();
        $rows = $query->orderBy('name')->orderBy('id')->forPage($page, $pageSize)->get();

        return $this->json([
            'items' => $rows->map(fn (Customer $c) => self::dto($c))->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            // Lo que el comercio tiene para cobrar en cuentas corrientes.
            'receivable' => Money::round((string) (Customer::where('balance', '>', 0)->selectRaw('SUM(balance) AS total')->value('total') ?? '0')),
        ]);
    }

    /** Ficha con los últimos movimientos de la cuenta. */
    public function show(Request $request, string $id): JsonResponse
    {
        $customer = Customer::find($id) ?? throw AppError::notFound('Cliente');
        $moves = CustomerMovement::where('customer_id', $id)->orderByDesc('created_at')->orderByDesc('id')->limit(200)->get();
        $sales = Sale::whereIn('id', $moves->pluck('sale_id')->filter())->get(['id', 'number', 'kind'])->keyBy('id');
        $users = User::whereIn('id', $moves->pluck('user_id')->unique())->pluck('name', 'id');

        return $this->json(self::dto($customer) + [
            'movements' => $moves->map(fn (CustomerMovement $m) => [
                'id' => $m->id,
                'kind' => $m->kind,
                'amount' => Money::round($m->amount),
                'balanceAfter' => Money::round($m->balance_after),
                'createdAt' => Dates::iso($m->created_at),
                'notes' => $m->notes,
                'userName' => $users[$m->user_id] ?? '',
                'sale' => isset($sales[$m->sale_id]) ? ['id' => $m->sale_id, 'number' => (int) $sales[$m->sale_id]->number] : null,
            ])->all(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->input($request, $actor);
        $customer = $this->unique(fn () => DB::transaction(function () use ($actor, $input) {
            $customer = Customer::create($input + ['balance' => '0.00', 'status' => 'active']);
            $this->record($actor, 'customer.created', $customer->id, null, $input);

            return $customer;
        }));

        return $this->json(self::dto($customer), 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->input($request, $actor, true);
        $customer = $this->unique(fn () => DB::transaction(function () use ($actor, $id, $input) {
            $customer = Customer::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Cliente');
            // Sin permiso para dar crédito, el límite queda como estaba.
            if (! $actor->can('accounts.grant_credit')) {
                unset($input['credit_limit']);
            }
            $before = $customer->only(array_keys($input));
            $customer->forceFill($input)->save();
            $this->record($actor, 'customer.updated', $id, $before, $input);

            return $customer;
        }));

        return $this->json(self::dto($customer));
    }

    /** Saldo inicial al empezar a usar el sistema, o una corrección con motivo. */
    public function adjust(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'amount' => ['required', 'string', 'regex:/^-?\d{1,12}(\.\d{1,2})?$/'],
            'notes' => ['required', 'string', 'max:200'],
        ], ['amount.regex' => 'Importe inválido']);
        if (Money::of($v['amount'])->isZero()) {
            throw AppError::validation([['path' => 'amount', 'message' => 'El importe no puede ser cero']]);
        }
        $customer = DB::transaction(function () use ($actor, $id, $v) {
            $customer = Customer::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Cliente');
            $before = Money::round($customer->balance);
            $this->accounts->adjust($actor, $customer, Money::of($v['amount']), trim($v['notes']));
            $this->record($actor, 'customer.balance_adjusted', $id, ['balance' => $before], ['balance' => Money::round($customer->balance), 'amount' => Money::round($v['amount']), 'notes' => trim($v['notes'])]);

            return $customer;
        });

        return $this->json(self::dto($customer));
    }

    /** Forma de CustomerDto. */
    public static function dto(Customer $c): array
    {
        return [
            'id' => $c->id, 'name' => $c->name, 'documentType' => $c->document_type, 'documentNumber' => $c->document_number,
            'vatCondition' => $c->vat_condition, 'phone' => $c->phone, 'email' => $c->email, 'address' => $c->address, 'notes' => $c->notes,
            'creditLimit' => $c->credit_limit === null ? null : Money::round($c->credit_limit), 'balance' => Money::round($c->balance), 'status' => $c->status,
        ];
    }

    /** Mismos límites que customerSchema de packages/contracts. */
    private function input(Request $request, Actor $actor, bool $withStatus = false): array
    {
        $v = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:120'],
            'documentType' => ['nullable', 'integer', 'in:80,86,96'],
            'documentNumber' => ['nullable', 'string', 'max:13'],
            'vatCondition' => ['required', 'integer', 'in:1,4,5,6'],
            'phone' => ['nullable', 'string', 'max:30'],
            'email' => ['nullable', 'string', 'email', 'max:254'],
            'address' => ['nullable', 'string', 'max:200'],
            'notes' => ['nullable', 'string', 'max:300'],
            'creditLimit' => ['nullable', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            ...($withStatus ? ['status' => ['required', 'in:active,inactive']] : []),
        ], ['vatCondition.in' => 'Condición frente al IVA inválida']);
        $type = isset($v['documentType']) ? (int) $v['documentType'] : null;
        $number = preg_replace('/\D/', '', (string) ($v['documentNumber'] ?? '')) ?: null;
        if (($type === null) !== ($number === null)) {
            throw AppError::validation([['path' => 'documentNumber', 'message' => 'Completá el tipo y el número de documento, o ninguno']]);
        }
        if ($type === 96 && ! preg_match('/^\d{6,9}$/', $number)) {
            throw AppError::validation([['path' => 'documentNumber', 'message' => 'Ingresá un DNI válido, sin puntos']]);
        }
        if (in_array($type, [80, 86], true) && ! Cuit::isValid($number)) {
            throw AppError::validation([['path' => 'documentNumber', 'message' => 'El CUIT o CUIL no es válido']]);
        }
        // Al editar, update() deja el límite como estaba si no tiene el permiso.
        if (! $withStatus && isset($v['creditLimit']) && ! $actor->can('accounts.grant_credit')) {
            throw AppError::forbidden('accounts.grant_credit');
        }

        return [
            'name' => trim($v['name']), 'document_type' => $type, 'document_number' => $number, 'vat_condition' => (int) $v['vatCondition'],
            'phone' => $v['phone'] ?? null, 'email' => isset($v['email']) ? mb_strtolower($v['email']) : null, 'address' => $v['address'] ?? null,
            'notes' => $v['notes'] ?? null, 'credit_limit' => isset($v['creditLimit']) ? Money::round($v['creditLimit']) : null,
            ...($withStatus ? ['status' => $v['status']] : []),
        ];
    }

    private function unique(\Closure $fn): Customer
    {
        try {
            return $fn();
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('DOCUMENT_TAKEN', 'Ya hay un cliente con ese documento');
        }
    }

    private function record(Actor $actor, string $action, string $id, ?array $before, ?array $after): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
            'action' => $action, 'entityType' => 'customer', 'entityId' => $id, 'before' => $before, 'after' => $after,
            'ip' => $actor->ip, 'requestId' => $actor->requestId,
        ]);
    }
}
