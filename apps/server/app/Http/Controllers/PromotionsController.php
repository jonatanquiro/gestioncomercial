<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Category;
use App\Models\Product;
use App\Models\Promotion;
use App\Services\AuditService;
use App\Services\EntitlementsService;
use App\Support\AppError;
use App\Support\Input;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Promociones del comercio (ADR 0020). Solo con un plan que las incluya. */
class PromotionsController extends Controller
{
    public function __construct(private readonly EntitlementsService $entitlements, private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $promotions = Promotion::orderByRaw("status = 'active' DESC")->orderByDesc('created_at')->get();
        $categories = Category::whereIn('id', $promotions->pluck('category_id')->filter())->pluck('name', 'id');
        $products = Product::whereIn('id', $promotions->pluck('product_id')->filter())->pluck('name', 'id');

        return $this->json($promotions->map(fn (Promotion $p) => $this->dto($p, $categories[$p->category_id] ?? $products[$p->product_id] ?? null))->all());
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->input($request);
        $promotion = DB::transaction(function () use ($actor, $input) {
            $promotion = Promotion::create($input + ['status' => 'active']);
            $this->record($actor, 'promotion.created', $promotion->id, null, $input);

            return $promotion;
        });

        return $this->json($this->dto($promotion->fresh(), $this->targetName($promotion)), 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        Promotion::whereKey($id)->exists() || throw AppError::notFound('Promoción');
        $input = $this->input($request, true);
        $promotion = DB::transaction(function () use ($actor, $id, $input) {
            $promotion = Promotion::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Promoción');
            $before = $promotion->only(array_keys($input));
            $promotion->forceFill($input)->save();
            $this->record($actor, 'promotion.updated', $id, $before, $input);

            return $promotion;
        });

        return $this->json($this->dto($promotion->fresh(), $this->targetName($promotion)));
    }

    /** Mismos límites que promotionSchema de packages/contracts. */
    private function input(Request $request, bool $withStatus = false): array
    {
        if (! in_array('promotions', $this->entitlements->plan()['features'] ?? [], true)) {
            throw AppError::badRequest('PROMOTIONS_PLAN', 'Tu plan no incluye promociones.');
        }
        $v = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:80'],
            'kind' => ['required', 'in:percent,nxm'],
            'percent' => ['required_if:kind,percent', 'nullable', ...Input::decimal(Input::PERCENT, 'Porcentaje inválido')],
            'buyQuantity' => ['required_if:kind,nxm', 'nullable', 'integer', 'min:2', 'max:100'],
            'payQuantity' => ['required_if:kind,nxm', 'nullable', 'integer', 'min:1', 'max:99'],
            'scope' => ['required', 'in:all,category,product'],
            'categoryId' => ['required_if:scope,category', 'nullable', 'uuid'],
            'productId' => ['required_if:scope,product', 'nullable', 'uuid'],
            'startsOn' => ['nullable', 'date_format:Y-m-d'],
            'endsOn' => ['nullable', 'date_format:Y-m-d'],
            ...($withStatus ? ['status' => ['required', 'in:active,inactive']] : []),
        ], [
            'percent.required_if' => 'Ingresá el porcentaje', 'buyQuantity.required_if' => 'Ingresá cuántas lleva', 'payQuantity.required_if' => 'Ingresá cuántas paga',
            'categoryId.required_if' => 'Elegí la categoría', 'productId.required_if' => 'Elegí el producto', 'buyQuantity.min' => 'Tiene que llevar al menos 2',
        ]);
        $percent = $v['kind'] === 'percent' ? Money::round($v['percent']) : null;
        if ($percent !== null && (Money::of($percent)->isZero() || Money::of($percent)->isGreaterThan(100))) {
            throw AppError::validation([['path' => 'percent', 'message' => 'El porcentaje va de 0,01 a 100']]);
        }
        if ($v['kind'] === 'nxm' && (int) $v['payQuantity'] >= (int) $v['buyQuantity']) {
            throw AppError::validation([['path' => 'payQuantity', 'message' => 'Tiene que pagar menos de las que lleva']]);
        }
        if (($v['startsOn'] ?? null) && ($v['endsOn'] ?? null) && $v['endsOn'] < $v['startsOn']) {
            throw AppError::validation([['path' => 'endsOn', 'message' => 'La fecha de fin no puede ser anterior a la de inicio']]);
        }
        if ($v['scope'] === 'category' && ! Category::whereKey($v['categoryId'])->exists()) {
            throw AppError::validation([['path' => 'categoryId', 'message' => 'La categoría no existe']]);
        }
        if ($v['scope'] === 'product' && ! Product::whereKey($v['productId'])->exists()) {
            throw AppError::validation([['path' => 'productId', 'message' => 'El producto no existe']]);
        }

        return [
            'name' => trim($v['name']), 'kind' => $v['kind'], 'percent' => $percent,
            'buy_quantity' => $v['kind'] === 'nxm' ? (int) $v['buyQuantity'] : null, 'pay_quantity' => $v['kind'] === 'nxm' ? (int) $v['payQuantity'] : null,
            'scope' => $v['scope'], 'category_id' => $v['scope'] === 'category' ? $v['categoryId'] : null, 'product_id' => $v['scope'] === 'product' ? $v['productId'] : null,
            'starts_on' => $v['startsOn'] ?? null, 'ends_on' => $v['endsOn'] ?? null,
            ...($withStatus ? ['status' => $v['status']] : []),
        ];
    }

    private function targetName(Promotion $p): ?string
    {
        return $p->category_id ? Category::whereKey($p->category_id)->value('name') : ($p->product_id ? Product::whereKey($p->product_id)->value('name') : null);
    }

    /** Forma de PromotionDto. */
    private function dto(Promotion $p, ?string $target): array
    {
        $today = Carbon::now('America/Buenos_Aires')->toDateString();
        $current = $p->status === 'active' && (! $p->starts_on || $p->starts_on->toDateString() <= $today) && (! $p->ends_on || $p->ends_on->toDateString() >= $today);

        return [
            'id' => $p->id, 'name' => $p->name, 'kind' => $p->kind, 'percent' => $p->percent === null ? null : Money::round($p->percent),
            'buyQuantity' => $p->buy_quantity, 'payQuantity' => $p->pay_quantity, 'scope' => $p->scope, 'categoryId' => $p->category_id, 'productId' => $p->product_id,
            'targetName' => $target, 'startsOn' => $p->starts_on?->toDateString(), 'endsOn' => $p->ends_on?->toDateString(), 'status' => $p->status, 'current' => $current,
        ];
    }

    private function record(Actor $actor, string $action, string $id, ?array $before, ?array $after): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
            'action' => $action, 'entityType' => 'promotion', 'entityId' => $id, 'before' => $before, 'after' => $after,
            'ip' => $actor->ip, 'requestId' => $actor->requestId,
        ]);
    }
}
