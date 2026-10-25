<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\PriceChangeBatch;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\AuditService;
use App\Services\ProductService;
use App\Support\AppError;
use App\Support\Input;
use App\Support\Money;
use App\Support\Pricing;
use Brick\Math\BigDecimal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Cambio masivo de precios con vista previa exacta (sección 8 del diseño). La vista previa
 * devuelve una huella de lo calculado; aplicar recalcula con las filas bloqueadas y solo sigue
 * si la huella coincide, así se aplica exactamente lo que se vio.
 */
class PricesController extends Controller
{
    /** Tope de artículos por cambio, para que la vista previa se pueda revisar. */
    public const MAX_ROWS = 5000;

    public function __construct(
        private readonly ProductService $products,
        private readonly AuditService $audit,
    ) {}

    public function preview(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->validated($this->body($request), $actor, false);

        return $this->json($this->compute($input, $actor, false));
    }

    public function apply(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->validated($this->body($request), $actor, true);

        return $this->json(DB::transaction(function () use ($actor, $input) {
            $result = $this->compute($input, $actor, true);
            if (! hash_equals($result['fingerprint'], $input['fingerprint'])) {
                throw AppError::conflict('PREVIEW_OUTDATED', 'Los precios cambiaron desde la vista previa. Volvé a generarla antes de aplicar.');
            }
            if ($result['rows'] === []) {
                throw AppError::badRequest('NOTHING_TO_APPLY', 'Ningún artículo cambia de precio');
            }
            $batch = PriceChangeBatch::create([
                'scope' => $input['scope'], 'rule' => $input['rule'], 'rounding_step' => $input['roundingStep'],
                'affected_count' => count($result['rows']), 'applied_by' => $actor->userId, 'applied_at' => Carbon::now(),
            ]);
            $variants = ProductVariant::whereIn('id', array_column($result['rows'], 'variantId'))->get()->keyBy('id');
            foreach ($result['rows'] as $row) {
                $this->products->setPrice($variants[$row['variantId']], $row['newPrice'], $actor->userId, $batch->id);
            }
            $this->audit->record([
                'tenantId' => $actor->tenantId,
                'actorType' => 'user',
                'actorId' => $actor->userId,
                'actorName' => $actor->userName,
                'action' => 'prices.bulk_updated',
                'entityType' => 'price_change_batch',
                'entityId' => $batch->id,
                'after' => ['scope' => $input['scope'], 'rule' => $input['rule'], 'roundingStep' => $input['roundingStep'], 'affected' => count($result['rows'])],
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);

            return ['batchId' => $batch->id, 'affectedCount' => count($result['rows'])];
        }));
    }

    private function validated(array $data, Actor $actor, bool $applying): array
    {
        $rules = [
            'scope' => ['required', 'array'],
            'scope.categoryId' => ['present', 'nullable', 'string', 'uuid'],
            'scope.brandId' => ['present', 'nullable', 'string', 'uuid'],
            'scope.productIds' => ['present', 'nullable', 'array', 'list', 'max:1000'],
            'scope.productIds.*' => ['string', 'uuid'],
            'rule' => ['required', 'array'],
            'rule.kind' => ['required', 'string', 'in:percent,fixed,markup,margin'],
            'rule.value' => ['required', ...Input::decimal(Input::RULE_VALUE, 'Valor inválido')],
            'roundingStep' => ['present', Input::oneOfIntegers([0, 1, 5, 10, 50, 100])],
        ];
        if ($applying) {
            $rules['fingerprint'] = ['required', 'string', 'regex:/^[0-9a-f]{64}$/'];
        }
        $v = Input::validate($data, $rules);
        $kind = $v['rule']['kind'];
        $value = $v['rule']['value'];
        if (in_array($kind, ['markup', 'margin'], true) && ! $actor->can('costs.read')) {
            throw AppError::forbidden('costs.read');
        }
        if ($kind === 'margin' && (BigDecimal::of($value)->isGreaterThanOrEqualTo(100) || BigDecimal::of($value)->isNegative())) {
            throw AppError::validation([['path' => 'rule.value', 'message' => 'El margen tiene que estar entre 0 y 99,99%']]);
        }
        if ($kind === 'markup' && BigDecimal::of($value)->isLessThanOrEqualTo(-100)) {
            throw AppError::validation([['path' => 'rule.value', 'message' => 'El recargo tiene que ser mayor a -100%']]);
        }
        $ids = $v['scope']['productIds'] ?? null;

        return [
            'scope' => [
                'categoryId' => $v['scope']['categoryId'] ?? null,
                'brandId' => $v['scope']['brandId'] ?? null,
                'productIds' => $ids === null ? null : array_values(array_unique($ids)),
            ],
            'rule' => ['kind' => $kind, 'value' => $value],
            'roundingStep' => (int) $v['roundingStep'],
            'fingerprint' => $v['fingerprint'] ?? null,
        ];
    }

    /** @return array{rows: list<array<string, mixed>>, skipped: list<array<string, string>>, fingerprint: string} */
    private function compute(array $input, Actor $actor, bool $lock): array
    {
        $scope = $input['scope'];
        $query = Product::where('status', 'active')
            ->when($scope['categoryId'], fn ($w, $id) => $w->where('category_id', $id))
            ->when($scope['brandId'], fn ($w, $id) => $w->where('brand_id', $id))
            ->when($scope['productIds'] !== null, fn ($w) => $w->whereIn('id', $scope['productIds']));
        if ((clone $query)->count() > self::MAX_ROWS) {
            throw AppError::badRequest('TOO_MANY_PRODUCTS', 'El cambio abarca más de '.self::MAX_ROWS.' artículos. Acotalo por categoría o marca.');
        }
        $products = $query->orderBy('name')->orderBy('id')->get(['id', 'name']);
        $variantQuery = ProductVariant::whereIn('product_id', $products->pluck('id'))->orderBy('id');
        $variants = ($lock ? $variantQuery->lockForUpdate() : $variantQuery)->get()->keyBy('product_id');

        ['kind' => $kind, 'value' => $value] = $input['rule'];
        $seeCost = $actor->can('costs.read');
        $rows = [];
        $skipped = [];
        foreach ($products as $p) {
            $v = $variants[$p->id];
            $old = Money::round($v->price);
            $cost = $v->cost === null ? null : Money::roundUnit($v->cost);
            if (in_array($kind, ['markup', 'margin'], true) && ($cost === null || BigDecimal::of($cost)->isZero())) {
                $skipped[] = ['productId' => $p->id, 'name' => $p->name, 'reason' => 'No tiene costo cargado'];

                continue;
            }
            $raw = match ($kind) {
                'percent' => Pricing::priceFromPercent($old, $value),
                'fixed' => Pricing::priceFromFixed($old, $value),
                'markup' => Pricing::priceFromMarkup($cost, $value),
                'margin' => Pricing::priceFromMargin($cost, $value),
            };
            if (BigDecimal::of($raw)->isNegative()) {
                $skipped[] = ['productId' => $p->id, 'name' => $p->name, 'reason' => 'El precio quedaría negativo'];

                continue;
            }
            $new = Pricing::roundPriceUp($raw, $input['roundingStep']);
            if (BigDecimal::of($new)->isEqualTo($old)) {
                $skipped[] = ['productId' => $p->id, 'name' => $p->name, 'reason' => 'El precio no cambia'];

                continue;
            }
            $rows[] = [
                'productId' => $p->id,
                'variantId' => $v->id,
                'name' => $p->name,
                'oldPrice' => $old,
                'newPrice' => $new,
                'variation' => BigDecimal::of($old)->isZero() ? null : Pricing::variationPercent($old, $new),
                'cost' => $seeCost ? $cost : null,
                'markup' => $seeCost && $cost !== null && ! BigDecimal::of($cost)->isZero() ? Pricing::markupPercentOf($cost, $new) : null,
                'margin' => $seeCost && $cost !== null && ! BigDecimal::of($new)->isZero() ? Pricing::marginPercentOf($cost, $new) : null,
            ];
        }
        $fingerprint = hash('sha256', json_encode(array_map(fn ($r) => [$r['variantId'], $r['oldPrice'], $r['newPrice']], $rows)));

        return ['rows' => $rows, 'skipped' => $skipped, 'fingerprint' => $fingerprint];
    }
}
