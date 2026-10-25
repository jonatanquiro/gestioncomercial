<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\AuditEntry;
use App\Models\Barcode;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockLevel;
use App\Models\User;
use App\Models\VariantCost;
use App\Models\VariantPrice;
use App\Models\Warehouse;
use App\Services\AuditService;
use App\Services\EntitlementsService;
use App\Services\ProductService;
use App\Services\StockService;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/** Productos y servicios (sección 4, Catálogo). La variante única del MVP viaja aplanada en el DTO. */
class ProductsController extends Controller
{
    public const VAT_RATES = ['21', '10.5', '27', '5', '2.5', '0', 'exento', 'no_gravado'];

    public const SALE_MODES = ['unit', 'weight', 'length', 'volume'];

    /** Campos del maestro que se auditan. */
    private const MASTER_FIELDS = [
        'kind' => 'kind', 'name' => 'name', 'description' => 'description', 'categoryId' => 'category_id', 'brandId' => 'brand_id',
        'saleMode' => 'sale_mode', 'vatRate' => 'vat_rate', 'trackStock' => 'track_stock', 'minStock' => 'min_stock',
        'blockNegativeStock' => 'block_negative_stock',
    ];

    public function __construct(
        private readonly EntitlementsService $entitlements,
        private readonly AuditService $audit,
        private readonly ProductService $products,
        private readonly StockService $stock,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'q' => ['nullable', 'string', 'max:100'],
            'categoryId' => ['nullable', 'string', 'uuid'],
            'brandId' => ['nullable', 'string', 'uuid'],
            'status' => ['nullable', 'string', 'in:active,inactive,all'],
        ]);
        $query = self::search(Product::query(), $q['q'] ?? null)
            ->when($q['categoryId'] ?? null, fn ($w, $id) => $w->where('category_id', $id))
            ->when($q['brandId'] ?? null, fn ($w, $id) => $w->where('brand_id', $id))
            ->when(($q['status'] ?? 'active') !== 'all', fn ($w) => $w->where('status', $q['status'] ?? 'active'));
        $total = (clone $query)->count();
        $rows = $query->orderBy('name')->orderBy('id')->forPage($page, $pageSize)->get();

        return $this->json(['items' => $this->dtos($rows, $actor), 'total' => $total, 'page' => $page, 'pageSize' => $pageSize]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->json($this->dto($id, $this->actor($request)));
    }

    /** Búsqueda exacta por código de barras o SKU (lector del POS y de los formularios de stock). */
    public function lookup(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $q = Input::validate($request->query(), ['code' => ['required', 'string', 'max:64']]);
        $barcode = Barcode::where('code', $q['code'])->first();
        $variant = $barcode ? ProductVariant::find($barcode->variant_id) : ProductVariant::where('sku', $q['code'])->first();
        if (! $variant) {
            throw AppError::notFound('Código');
        }

        return $this->json(['product' => $this->dto($variant->product_id, $actor), 'quantityFactor' => $barcode ? Money::quantity($barcode->quantity_factor) : '1.000']);
    }

    public function history(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $variant = ProductVariant::where('product_id', $id)->first() ?? throw AppError::notFound('Producto');
        $prices = VariantPrice::where('variant_id', $variant->id)->orderByDesc('valid_from')->limit(100)->get();
        $costs = $actor->can('costs.read') ? VariantCost::where('variant_id', $variant->id)->orderByDesc('at')->limit(100)->get() : collect();
        $users = User::whereIn('id', $prices->pluck('changed_by')->merge($costs->pluck('changed_by'))->filter()->unique())->pluck('name', 'id');
        $changes = AuditEntry::where('tenant_id', $actor->tenantId)->where('entity_type', 'product')->where('entity_id', $id)
            ->orderByDesc('at')->limit(100)->get();

        return $this->json([
            'prices' => $prices->map(fn (VariantPrice $p) => [
                'price' => $p->price, 'validFrom' => Dates::iso($p->valid_from), 'validTo' => Dates::iso($p->valid_to),
                'changedBy' => $users[$p->changed_by] ?? null, 'batchId' => $p->batch_id,
            ])->all(),
            'costs' => $costs->map(fn (VariantCost $c) => [
                'cost' => $c->cost, 'source' => $c->source, 'at' => Dates::iso($c->at), 'changedBy' => $users[$c->changed_by] ?? null,
            ])->all(),
            'changes' => $changes->map(fn (AuditEntry $e) => [
                'at' => Dates::iso($e->at), 'actorName' => $e->actor_name, 'action' => $e->action,
                'before' => $this->hideCosts($e->before, $actor), 'after' => $this->hideCosts($e->after, $actor),
            ])->all(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->validated($this->body($request), true);
        if ($input['cost'] !== null && ! $actor->can('costs.update')) {
            throw AppError::forbidden('costs.update');
        }
        $initial = $input['initialStock'];
        if ($initial !== null && ! BigDecimal::of($initial)->isZero() && ! $actor->can('stock.adjust')) {
            throw AppError::forbidden('stock.adjust');
        }

        $id = $this->guardUnique(fn () => DB::transaction(function () use ($actor, $input, $initial) {
            $this->entitlements->lockTenant($actor->tenantId);
            $this->entitlements->assertBelowLimit('max_products', Product::where('status', 'active')->count());
            $this->assertReferences($input);
            $this->assertCodesFree($input, null);

            $product = Product::create([...$this->masterColumns($input), 'status' => 'active', 'created_by' => $actor->userId]);
            $variant = ProductVariant::create(['product_id' => $product->id, 'sku' => $input['sku'], 'price' => $input['price'], 'cost' => null]);
            $this->products->setPrice($variant, $input['price'], $actor->userId, initial: true);
            if ($input['cost'] !== null) {
                $this->products->setCost($variant, $input['cost'], 'initial', $actor->userId, initial: true);
            }
            $this->saveBarcodes($variant->id, $input['barcodes']);
            $this->stock->initVariant($variant->id);
            if ($initial !== null && $product->track_stock && ! BigDecimal::of($initial)->isZero()) {
                $warehouse = Warehouse::where('is_default', true)->orderBy('created_at')->first() ?? throw AppError::notFound('Depósito');
                $this->stock->apply(
                    [['warehouseId' => $warehouse->id, 'variantId' => $variant->id, 'type' => 'adjust', 'quantity' => $initial, 'sourceLineId' => $variant->id]],
                    ['sourceType' => 'initial_stock', 'sourceId' => $product->id, 'reason' => 'Stock inicial', 'userId' => $actor->userId],
                );
            }
            $this->record($actor, 'product.created', $product->id, null, $this->auditView($input));

            return $product->id;
        }));

        return $this->json($this->dto($id, $actor), 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = $this->validated($this->body($request), false);

        $this->guardUnique(fn () => DB::transaction(function () use ($actor, $id, $input) {
            $product = Product::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Producto');
            if ($product->version !== $input['version']) {
                throw AppError::conflict('VERSION_CONFLICT', 'Otra persona modificó este producto. Cerrá y volvé a abrirlo para ver los cambios.');
            }
            $variant = ProductVariant::where('product_id', $id)->lockForUpdate()->firstOrFail();
            // Quien no ve costos no los puede pisar sin querer: se conserva el vigente.
            if (! $actor->can('costs.read')) {
                $input['cost'] = $variant->cost === null ? null : Money::roundUnit($variant->cost);
            }
            $priceChanges = ! BigDecimal::of($variant->price)->isEqualTo($input['price']);
            $costChanges = $variant->cost === null ? $input['cost'] !== null : ($input['cost'] === null || ! BigDecimal::of($variant->cost)->isEqualTo($input['cost']));
            if ($priceChanges && ! $actor->can('prices.update')) {
                throw AppError::forbidden('prices.update');
            }
            if ($costChanges && ! $actor->can('costs.update')) {
                throw AppError::forbidden('costs.update');
            }
            if ($product->track_stock && ! $input['trackStock'] && StockLevel::where('variant_id', $variant->id)->where('on_hand', '<>', 0)->exists()) {
                throw AppError::conflict('STOCK_NOT_ZERO', 'Para dejar de controlar el stock, primero llevalo a cero con un ajuste.');
            }
            $this->assertReferences($input);
            $this->assertCodesFree($input, $variant->id);

            $before = $this->auditView($this->currentInput($product, $variant));
            $product->forceFill([...$this->masterColumns($input), 'version' => $product->version + 1])->save();
            $variant->forceFill(['sku' => $input['sku']])->save();
            $this->products->setPrice($variant, $input['price'], $actor->userId);
            $this->products->setCost($variant, $input['cost'], 'manual', $actor->userId);
            Barcode::where('variant_id', $variant->id)->delete();
            $this->saveBarcodes($variant->id, $input['barcodes']);
            $after = $this->auditView($input);
            $this->record($actor, 'product.updated', $id, ...self::diff($before, $after));
        }));

        return $this->json($this->dto($id, $actor));
    }

    public function setStatus(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), ['status' => ['required', 'string', 'in:active,inactive']]);

        DB::transaction(function () use ($actor, $id, $input) {
            $this->entitlements->lockTenant($actor->tenantId);
            $product = Product::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Producto');
            if ($product->status === $input['status']) {
                return;
            }
            if ($input['status'] === 'active') {
                $this->entitlements->assertBelowLimit('max_products', Product::where('status', 'active')->count());
            }
            $previous = $product->status;
            $product->forceFill(['status' => $input['status'], 'version' => $product->version + 1])->save();
            ProductVariant::where('product_id', $id)->update(['status' => $input['status']]);
            $this->record($actor, $input['status'] === 'active' ? 'product.activated' : 'product.deactivated', $id, ['status' => $previous], ['status' => $input['status']]);
        });

        return $this->json($this->dto($id, $actor));
    }

    // ------------------------------------------------------------------ Consulta

    /** Filtro de texto: nombre que contiene, o SKU o código de barras exacto. */
    public static function search(Builder $query, ?string $term): Builder
    {
        if ($term === null || $term === '') {
            return $query;
        }
        $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';

        return $query->where(function ($w) use ($term, $like) {
            $w->where('products.name', 'like', $like)
                ->orWhereIn('products.id', ProductVariant::where('sku', $term)->select('product_id'))
                ->orWhereIn('products.id', ProductVariant::whereIn('id', Barcode::where('code', $term)->select('variant_id'))->select('product_id'));
        });
    }

    private function dto(string $id, Actor $actor): array
    {
        $product = Product::find($id) ?? throw AppError::notFound('Producto');

        return $this->dtos(collect([$product]), $actor)[0];
    }

    /**
     * Forma de ProductDto, armada en pocas consultas para una página entera.
     *
     * @param  Collection<int, Product>  $products
     */
    private function dtos(Collection $products, Actor $actor): array
    {
        if ($products->isEmpty()) {
            return [];
        }
        $variants = ProductVariant::whereIn('product_id', $products->pluck('id'))->get()->keyBy('product_id');
        $categories = Category::whereIn('id', $products->pluck('category_id')->filter()->unique())->pluck('name', 'id');
        $brands = Brand::whereIn('id', $products->pluck('brand_id')->filter()->unique())->pluck('name', 'id');
        $barcodes = Barcode::whereIn('variant_id', $variants->pluck('id'))->orderBy('created_at')->orderBy('code')->get()->groupBy('variant_id');
        $stock = $actor->can('stock.read')
            ? StockLevel::whereIn('variant_id', $variants->pluck('id'))->groupBy('variant_id')->selectRaw('variant_id, SUM(on_hand) AS total')->pluck('total', 'variant_id')
            : collect();
        $seeCost = $actor->can('costs.read');

        return $products->map(function (Product $p) use ($variants, $categories, $brands, $barcodes, $stock, $seeCost, $actor) {
            $v = $variants[$p->id];

            return [
                'id' => $p->id,
                'variantId' => $v->id,
                'kind' => $p->kind,
                'name' => $p->name,
                'description' => $p->description,
                'categoryId' => $p->category_id,
                'categoryName' => $categories[$p->category_id] ?? null,
                'brandId' => $p->brand_id,
                'brandName' => $brands[$p->brand_id] ?? null,
                'saleMode' => $p->sale_mode,
                'vatRate' => $p->vat_rate,
                'trackStock' => $p->track_stock,
                'minStock' => $p->min_stock === null ? null : Money::quantity($p->min_stock),
                'blockNegativeStock' => $p->block_negative_stock,
                'sku' => $v->sku,
                'price' => Money::round($v->price),
                'cost' => $seeCost && $v->cost !== null ? Money::roundUnit($v->cost) : null,
                'barcodes' => collect($barcodes->get($v->id, []))->map(fn (Barcode $b) => ['code' => $b->code, 'quantityFactor' => Money::quantity($b->quantity_factor)])->values()->all(),
                'stock' => $p->track_stock && $actor->can('stock.read') ? Money::quantity($stock[$v->id] ?? '0') : null,
                'status' => $p->status,
                'version' => $p->version,
                'updatedAt' => Dates::iso($p->updated_at),
            ];
        })->values()->all();
    }

    // ------------------------------------------------------------------ Alta y edición

    /** Valida con los mismos límites que createProductSchema / updateProductSchema. */
    private function validated(array $data, bool $creating): array
    {
        $rules = [
            'kind' => ['required', 'string', 'in:good,service'],
            'name' => ['required', 'string', 'max:160'],
            'description' => ['nullable', 'string', 'max:500'],
            'categoryId' => ['present', 'nullable', 'string', 'uuid'],
            'brandId' => ['present', 'nullable', 'string', 'uuid'],
            'saleMode' => ['required', 'string', Rule::in(self::SALE_MODES)],
            'vatRate' => ['required', 'string', Rule::in(self::VAT_RATES)],
            'trackStock' => ['present', Input::strictBoolean()],
            'minStock' => ['present', 'nullable', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
            'blockNegativeStock' => ['present', Input::strictBoolean()],
            'sku' => ['nullable', 'string', 'max:60'],
            'price' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'cost' => ['present', 'nullable', ...Input::decimal(Input::COST, 'Costo inválido')],
            'barcodes' => ['present', 'array', 'list', 'max:20'],
            'barcodes.*' => ['array'],
            'barcodes.*.code' => ['required', 'string', 'max:64', 'regex:/^[0-9A-Za-z.\-_\/]+$/', 'distinct'],
            'barcodes.*.quantityFactor' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
        ];
        $rules += $creating
            ? ['initialStock' => ['present', 'nullable', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')]]
            : ['version' => ['required', 'integer', 'min:1']];
        $v = Input::validate($data, $rules, [
            'barcodes.*.code.regex' => 'Solo letras, números y . - _ /',
            'barcodes.*.code.distinct' => 'Código repetido',
        ]);

        $input = [
            'kind' => $v['kind'],
            'name' => $v['name'],
            'description' => $v['description'] ?? null,
            'categoryId' => $v['categoryId'] ?? null,
            'brandId' => $v['brandId'] ?? null,
            'saleMode' => $v['saleMode'],
            'vatRate' => $v['vatRate'],
            // Los servicios no tienen stock.
            'trackStock' => $v['kind'] === 'good' && $v['trackStock'],
            'minStock' => isset($v['minStock']) ? Money::quantity($v['minStock']) : null,
            'blockNegativeStock' => (bool) $v['blockNegativeStock'],
            'sku' => $v['sku'] ?? null,
            'price' => Money::round($v['price']),
            'cost' => isset($v['cost']) ? Money::roundUnit($v['cost']) : null,
            'barcodes' => array_map(fn ($b) => ['code' => $b['code'], 'quantityFactor' => Money::quantity($b['quantityFactor'])], $v['barcodes']),
        ];
        if ($creating) {
            $input['initialStock'] = isset($v['initialStock']) && $input['trackStock'] ? Money::quantity($v['initialStock']) : null;
        } else {
            $input['version'] = (int) $v['version'];
        }

        $details = [];
        foreach ($input['barcodes'] as $i => $b) {
            if (BigDecimal::of($b['quantityFactor'])->isZero()) {
                $details[] = ['path' => "barcodes.{$i}.quantityFactor", 'message' => 'Debe ser mayor a cero'];
            }
        }
        // Lo que se vende por unidad se cuenta en unidades enteras.
        if ($input['saleMode'] === 'unit') {
            $quantities = ['minStock' => $input['minStock'], 'initialStock' => $input['initialStock'] ?? null];
            foreach ($input['barcodes'] as $i => $b) {
                $quantities["barcodes.{$i}.quantityFactor"] = $b['quantityFactor'];
            }
            foreach ($quantities as $path => $q) {
                if ($q !== null && BigDecimal::of($q)->hasNonZeroFractionalPart()) {
                    $details[] = ['path' => $path, 'message' => 'En la venta por unidad, la cantidad tiene que ser entera'];
                }
            }
        }
        if ($details !== []) {
            throw AppError::validation($details);
        }

        return $input;
    }

    /** Categoría y marca tienen que ser del comercio (el filtro automático devuelve 404 si no). */
    private function assertReferences(array $input): void
    {
        if ($input['categoryId'] && ! Category::whereKey($input['categoryId'])->exists()) {
            throw AppError::notFound('Categoría');
        }
        if ($input['brandId'] && ! Brand::whereKey($input['brandId'])->exists()) {
            throw AppError::notFound('Marca');
        }
    }

    /** Código de barras y SKU únicos en el comercio, con un mensaje que dice dónde está el repetido. */
    private function assertCodesFree(array $input, ?string $ownVariantId): void
    {
        $codes = array_column($input['barcodes'], 'code');
        if ($codes !== []) {
            $taken = Barcode::whereIn('code', $codes)->when($ownVariantId, fn ($w) => $w->where('variant_id', '<>', $ownVariantId))->get();
            if ($taken->isNotEmpty()) {
                $names = Product::whereIn('id', ProductVariant::whereIn('id', $taken->pluck('variant_id'))->select('product_id'))->pluck('name')->all();
                throw new AppError(409, 'BARCODE_DUPLICATE', 'El código '.$taken->first()->code.' ya está cargado en '.implode(', ', $names),
                    $taken->map(fn ($b) => ['code' => $b->code])->values()->all());
            }
        }
        if ($input['sku'] !== null) {
            $sku = ProductVariant::where('sku', $input['sku'])->when($ownVariantId, fn ($w) => $w->whereKeyNot($ownVariantId))->first();
            if ($sku) {
                throw AppError::conflict('SKU_DUPLICATE', "El código interno {$input['sku']} ya está cargado en ".Product::find($sku->product_id)?->name);
            }
        }
    }

    /** Si dos altas simultáneas usan el mismo código, la base rechaza la segunda: se informa igual que la verificación previa. */
    private function guardUnique(\Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (UniqueConstraintViolationException $e) {
            if (str_contains($e->getMessage(), 'barcodes_tenant_code_uq')) {
                throw AppError::conflict('BARCODE_DUPLICATE', 'Uno de los códigos de barras ya está cargado en otro producto');
            }
            if (str_contains($e->getMessage(), 'product_variants_tenant_sku_uq')) {
                throw AppError::conflict('SKU_DUPLICATE', 'El código interno ya está cargado en otro producto');
            }
            throw $e;
        }
    }

    private function saveBarcodes(string $variantId, array $barcodes): void
    {
        $now = now()->format('Y-m-d H:i:s.u');
        Barcode::insertForTenant(array_map(fn ($b) => [
            'id' => (string) Str::uuid7(), 'variant_id' => $variantId, 'code' => $b['code'], 'quantity_factor' => $b['quantityFactor'], 'created_at' => $now,
        ], $barcodes));
    }

    private function masterColumns(array $input): array
    {
        $out = [];
        foreach (self::MASTER_FIELDS as $key => $column) {
            $out[$column] = $input[$key];
        }

        return $out;
    }

    private function currentInput(Product $p, ProductVariant $v): array
    {
        $input = [];
        foreach (self::MASTER_FIELDS as $key => $column) {
            $input[$key] = $p->{$column};
        }
        $input['minStock'] = $p->min_stock === null ? null : Money::quantity($p->min_stock);

        return $input + [
            'sku' => $v->sku,
            'price' => Money::round($v->price),
            'cost' => $v->cost === null ? null : Money::roundUnit($v->cost),
            'barcodes' => Barcode::where('variant_id', $v->id)->orderBy('code')->get()
                ->map(fn ($b) => ['code' => $b->code, 'quantityFactor' => Money::quantity($b->quantity_factor)])->all(),
        ];
    }

    private function auditView(array $input): array
    {
        $view = array_intersect_key($input, self::MASTER_FIELDS + ['sku' => 1, 'price' => 1, 'cost' => 1]);
        $barcodes = $input['barcodes'];
        usort($barcodes, fn ($a, $b) => strcmp($a['code'], $b['code']));
        $view['barcodes'] = array_map(fn ($b) => $b['code'].($b['quantityFactor'] !== '1.000' ? " ×{$b['quantityFactor']}" : ''), $barcodes);

        return $view;
    }

    /** Solo los campos que cambiaron. @return array{0: array, 1: array} */
    private static function diff(array $before, array $after): array
    {
        $b = [];
        $a = [];
        foreach ($after as $key => $value) {
            if (($before[$key] ?? null) !== $value) {
                $b[$key] = $before[$key] ?? null;
                $a[$key] = $value;
            }
        }

        return [$b, $a];
    }

    private function hideCosts(mixed $values, Actor $actor): mixed
    {
        if (is_array($values) && ! $actor->can('costs.read')) {
            unset($values['cost']);
        }

        return $values;
    }

    private function record(Actor $actor, string $action, string $id, ?array $before, ?array $after): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId,
            'actorType' => 'user',
            'actorId' => $actor->userId,
            'actorName' => $actor->userName,
            'action' => $action,
            'entityType' => 'product',
            'entityId' => $id,
            'before' => $before,
            'after' => $after,
            'ip' => $actor->ip,
            'requestId' => $actor->requestId,
        ]);
    }
}
