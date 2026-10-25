<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Branch;
use App\Models\CashCount;
use App\Models\CashMovement;
use App\Models\CashShift;
use App\Models\Register;
use App\Models\Sale;
use App\Models\User;
use App\Services\AuditService;
use App\Services\CashService;
use App\Services\EntitlementsService;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Cajas de cada sucursal y sus turnos: apertura, retiros, ingresos, arqueos y cierre ciego. */
class CashController extends Controller
{
    public function __construct(
        private readonly CashService $cash,
        private readonly EntitlementsService $entitlements,
        private readonly AuditService $audit,
    ) {}

    /** Cajas visibles para el actor con su turno abierto, si lo hay. */
    public function registers(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $registers = Register::query()
            ->when(! $actor->can('branches.manage'), fn ($w) => $w->whereIn('branch_id', $actor->branchIds))
            ->orderBy('name')->get();
        $branches = Branch::pluck('name', 'id');
        $open = CashShift::whereIn('register_id', $registers->pluck('id'))->where('status', 'open')->get()->keyBy('register_id');
        $users = User::whereIn('id', $open->pluck('opened_by'))->pluck('name', 'id');

        return $this->json($registers->map(fn (Register $r) => [
            'id' => $r->id,
            'name' => $r->name,
            'branchId' => $r->branch_id,
            'branchName' => $branches[$r->branch_id] ?? '',
            'status' => $r->status,
            'openShift' => isset($open[$r->id]) ? [
                'id' => $open[$r->id]->id,
                'openedAt' => Dates::iso($open[$r->id]->opened_at),
                'openedByName' => $users[$open[$r->id]->opened_by] ?? '',
            ] : null,
        ])->sortBy(['branchName', 'name'])->values()->all());
    }

    public function storeRegister(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'branchId' => ['required', 'string', 'uuid'],
            'name' => ['required', 'string', 'max:60'],
        ]);
        $input['name'] = trim($input['name']);
        Branch::find($input['branchId']) ?? throw AppError::notFound('Sucursal');
        try {
            $register = DB::transaction(function () use ($actor, $input) {
                $this->entitlements->lockTenant($actor->tenantId);
                $this->entitlements->assertBelowLimit('max_registers', Register::where('status', 'active')->count());
                $register = Register::create(['branch_id' => $input['branchId'], 'name' => $input['name']]);
                $this->record($actor, 'register.created', 'register', $register->id, $input);

                return $register;
            });
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('NAME_TAKEN', 'Ya hay una caja con ese nombre en la sucursal');
        }

        return $this->json(['id' => $register->id], 201);
    }

    public function updateRegister(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:60'],
            'status' => ['required', 'string', 'in:active,inactive'],
        ]);
        $input['name'] = trim($input['name']);
        try {
            DB::transaction(function () use ($actor, $id, $input) {
                $this->entitlements->lockTenant($actor->tenantId);
                $register = Register::find($id) ?? throw AppError::notFound('Caja');
                $before = ['name' => $register->name, 'status' => $register->status];
                if ($input['status'] === 'inactive' && CashShift::where('register_id', $id)->where('status', 'open')->exists()) {
                    throw AppError::conflict('SHIFT_OPEN', 'La caja tiene un turno abierto: cerralo antes de desactivarla');
                }
                if ($register->status === 'inactive' && $input['status'] === 'active') {
                    $this->entitlements->assertBelowLimit('max_registers', Register::where('status', 'active')->count());
                }
                $register->fill($input)->save();
                $this->record($actor, 'register.updated', 'register', $id, $input, $before);
            });
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('NAME_TAKEN', 'Ya hay una caja con ese nombre en la sucursal');
        }

        return $this->json(['ok' => true]);
    }

    public function shifts(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'registerId' => ['nullable', 'string', 'uuid'],
            'status' => ['nullable', 'string', 'in:open,closed'],
        ]);
        $query = CashShift::query()
            ->when(! $actor->can('cash.read_all'), fn ($w) => $w->where('opened_by', $actor->userId))
            ->when($q['registerId'] ?? null, fn ($w, $id) => $w->where('register_id', $id))
            ->when($q['status'] ?? null, fn ($w, $s) => $w->where('status', $s));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('opened_at')->orderByDesc('id')->forPage($page, $pageSize)->get();
        $registers = Register::whereIn('id', $rows->pluck('register_id'))->pluck('name', 'id');
        $users = User::whereIn('id', $rows->pluck('opened_by')->merge($rows->pluck('closed_by'))->filter()->unique())->pluck('name', 'id');

        return $this->json([
            'items' => $rows->map(fn (CashShift $s) => [
                'id' => $s->id,
                'registerId' => $s->register_id,
                'registerName' => $registers[$s->register_id] ?? '',
                'status' => $s->status,
                'openedAt' => Dates::iso($s->opened_at),
                'openedByName' => $users[$s->opened_by] ?? '',
                'closedAt' => Dates::iso($s->closed_at),
                'closedByName' => $users[$s->closed_by] ?? null,
                'difference' => $s->difference === null ? null : Money::round($s->difference),
            ])->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    public function showShift(Request $request, string $id): JsonResponse
    {
        return $this->json($this->shiftDto($this->actor($request), $id));
    }

    public function openShift(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'registerId' => ['required', 'string', 'uuid'],
            'openingFloat' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
        ]);
        $shift = $this->cash->open($actor, $input['registerId'], $input['openingFloat']);

        return $this->json($this->shiftDto($actor, $shift->id), 201);
    }

    public function movement(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'type' => ['required', 'string', 'in:withdrawal,deposit'],
            'amount' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'reason' => ['required', 'string', 'max:200'],
        ]);
        if (Money::of($input['amount'])->isZero()) {
            throw AppError::validation([['path' => 'amount', 'message' => 'El importe no puede ser cero']]);
        }
        $this->cash->move($actor, $id, $input['type'], $input['amount'], trim($input['reason']));

        return $this->json($this->shiftDto($actor, $id), 201);
    }

    public function count(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'counted' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
        ]);
        $this->cash->count($actor, $id, $input['counted']);

        return $this->json($this->shiftDto($actor, $id), 201);
    }

    public function close(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'counted' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'notes' => ['nullable', 'string', 'max:300'],
        ]);
        $this->cash->close($actor, $id, $input['counted'], isset($input['notes']) ? (trim($input['notes']) ?: null) : null);

        return $this->json($this->shiftDto($actor, $id));
    }

    /**
     * Forma de CashShiftDto. El efectivo esperado, las diferencias y los totales por medio de pago
     * solo se muestran con cash.read_all o con el turno ya cerrado: el cierre es ciego.
     */
    private function shiftDto(Actor $actor, string $id): array
    {
        $shift = CashShift::find($id) ?? throw AppError::notFound('Turno');
        $register = Register::find($shift->register_id);
        $this->cash->assertBranch($actor, $register->branch_id);
        if (! $actor->can('cash.read_all') && $shift->opened_by !== $actor->userId && $shift->status !== 'open') {
            throw AppError::notFound('Turno');
        }
        $reveal = $actor->can('cash.read_all') || $shift->status === 'closed';
        $movements = CashMovement::where('shift_id', $id)->orderBy('occurred_at')->orderBy('id')->get();
        $counts = CashCount::where('shift_id', $id)->orderBy('counted_at')->get();
        $users = User::whereIn('id', collect([$shift->opened_by, $shift->closed_by])->merge($movements->pluck('user_id'))->merge($counts->pluck('counted_by'))->filter()->unique())
            ->pluck('name', 'id');
        $sales = Sale::where('shift_id', $id)->where('status', 'confirmed');

        return [
            'id' => $shift->id,
            'registerId' => $register->id,
            'registerName' => $register->name,
            'status' => $shift->status,
            'openingFloat' => Money::round($shift->opening_float),
            'openedAt' => Dates::iso($shift->opened_at),
            'openedByName' => $users[$shift->opened_by] ?? '',
            'closedAt' => Dates::iso($shift->closed_at),
            'closedByName' => $users[$shift->closed_by] ?? null,
            'salesCount' => (clone $sales)->count(),
            'salesTotal' => Money::round((string) (clone $sales)->sum('total')),
            'expectedCash' => $reveal ? Money::round($shift->status === 'closed' ? $shift->expected_cash : $this->cash->expectedCash($shift)) : null,
            'countedCash' => $shift->counted_cash === null ? null : Money::round($shift->counted_cash),
            'difference' => $shift->difference === null ? null : Money::round($shift->difference),
            'totalsByMethod' => $reveal ? ($shift->status === 'closed' ? $shift->totals_by_method : $this->cash->totalsByMethod($id)) : null,
            'closingNotes' => $shift->closing_notes,
            'movements' => $movements->filter(fn (CashMovement $m) => $reveal || in_array($m->type, ['withdrawal', 'deposit'], true))->map(fn (CashMovement $m) => [
                'id' => $m->id,
                'type' => $m->type,
                'amount' => Money::round($m->amount),
                'reason' => $m->reason,
                'userName' => $users[$m->user_id] ?? '',
                'occurredAt' => Dates::iso($m->occurred_at),
            ])->values()->all(),
            'counts' => $counts->map(fn (CashCount $c) => [
                'kind' => $c->kind,
                'counted' => Money::round($c->counted),
                'expected' => $reveal ? Money::round($c->expected) : null,
                'difference' => $reveal ? Money::round(Money::of($c->counted)->minus($c->expected)) : null,
                'countedByName' => $users[$c->counted_by] ?? '',
                'countedAt' => Dates::iso($c->counted_at),
            ])->all(),
        ];
    }

    private function record(Actor $actor, string $action, string $type, string $id, array $after, ?array $before = null): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId,
            'actorType' => 'user',
            'actorId' => $actor->userId,
            'actorName' => $actor->userName,
            'action' => $action,
            'entityType' => $type,
            'entityId' => $id,
            'before' => $before,
            'after' => $after,
            'ip' => $actor->ip,
            'requestId' => $actor->requestId,
        ]);
    }
}
