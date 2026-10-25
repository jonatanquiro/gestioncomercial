<?php

namespace App\Http\Controllers;

use App\Models\PaymentMethod;
use App\Services\AuditService;
use App\Support\AppError;
use App\Support\Input;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Medios de pago que acepta el comercio. Un medio usado no se borra: se desactiva. */
class PaymentMethodsController extends Controller
{
    public const KINDS = ['cash', 'debit', 'credit', 'transfer', 'qr', 'other'];

    public function __construct(private readonly AuditService $audit) {}

    public function index(): JsonResponse
    {
        return $this->json(PaymentMethod::orderBy('sort_order')->orderBy('name')->get()->map(fn (PaymentMethod $m) => [
            'id' => $m->id, 'name' => $m->name, 'kind' => $m->kind, 'requiresReference' => $m->requires_reference,
            'active' => $m->active, 'sortOrder' => (int) $m->sort_order,
        ])->all());
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->input($request);
        try {
            $method = DB::transaction(function () use ($actor, $input) {
                $method = PaymentMethod::create([
                    'name' => $input['name'], 'kind' => $input['kind'], 'requires_reference' => $input['requiresReference'],
                    'active' => $input['active'], 'sort_order' => $input['sortOrder'],
                ]);
                $this->record($actor, 'payment_method.created', $method->id, $input);

                return $method;
            });
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('NAME_TAKEN', 'Ya hay un medio de pago con ese nombre');
        }

        return $this->json(['id' => $method->id], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->input($request);
        try {
            DB::transaction(function () use ($actor, $id, $input) {
                $method = PaymentMethod::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Medio de pago');
                $before = ['name' => $method->name, 'kind' => $method->kind, 'requiresReference' => $method->requires_reference, 'active' => $method->active, 'sortOrder' => (int) $method->sort_order];
                $method->forceFill([
                    'name' => $input['name'], 'kind' => $input['kind'], 'requires_reference' => $input['requiresReference'],
                    'active' => $input['active'], 'sort_order' => $input['sortOrder'],
                ])->save();
                $this->record($actor, 'payment_method.updated', $id, $input, $before);
            });
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('NAME_TAKEN', 'Ya hay un medio de pago con ese nombre');
        }

        return $this->json(['ok' => true]);
    }

    private function input(Request $request): array
    {
        $input = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:60'],
            'kind' => ['required', 'string', 'in:'.implode(',', self::KINDS)],
            'requiresReference' => ['present', Input::strictBoolean()],
            'active' => ['present', Input::strictBoolean()],
            'sortOrder' => ['required', 'integer', 'min:0', 'max:999'],
        ]);
        $input['name'] = trim($input['name']);
        $input['requiresReference'] = (bool) $input['requiresReference'];
        $input['active'] = (bool) $input['active'];
        $input['sortOrder'] = (int) $input['sortOrder'];

        return $input;
    }

    private function record($actor, string $action, string $id, array $after, ?array $before = null): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
            'action' => $action, 'entityType' => 'payment_method', 'entityId' => $id, 'before' => $before, 'after' => $after,
            'ip' => $actor->ip, 'requestId' => $actor->requestId,
        ]);
    }
}
