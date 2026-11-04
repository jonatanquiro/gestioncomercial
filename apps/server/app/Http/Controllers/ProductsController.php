<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Http\Controllers\Concerns\ImportsProducts;
use App\Models\AuditEntry;
use App\Models\Barcode;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\ReferenceProduct;
use App\Models\Sale;
use App\Models\SaleLine;
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

/**
 * Productos y servicios (sección 4, Catálogo). Un producto tiene una o más variantes (ADR 0013):
 * sin propiedades, una sola sin etiqueta; con propiedades (Talle, Color), una por combinación.
 */
class ProductsController extends Controller
{
    use ImportsProducts;

    public const VAT_RATES = ['21', '10.5', '27', '5', '2.5', '0', 'exento', 'no_gravado'];

    public const SALE_MODES = ['unit', 'weight', 'length', 'volume'];

    /** Mismos límites que MAX_PRODUCT_OPTIONS / MAX_PRODUCT_VARIANTS de packages/contracts. */
    public const MAX_OPTIONS = 3;

    public const MAX_VARIANTS = 100;

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

    /**
     * Buscador por variante para vender o contar, también sin código de barras: cada palabra tiene
     * que estar en el nombre o en la etiqueta («remera m rojo»). Solo productos activos.
     */
    public function items(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), ['q' => ['nullable', 'string', 'max:100']]);
        $query = self::searchVariants(self::activeVariants(), $q['q'] ?? null)->where('products.status', 'active');
        $total = (clone $query)->count();
        $rows = $query->orderBy('products.name')->orderBy('product_variants.label')->orderBy('product_variants.id')
            ->forPage($page, $pageSize)->get(['product_variants.*']);

        return $this->json(['items' => $this->itemDtos($rows, $actor), 'total' => $total, 'page' => $page, 'pageSize' => $pageSize]);
    }

    /** Accesos rápidos del punto de venta: las variantes activas más vendidas de los últimos 30 días. */
    public function favorites(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $recent = Sale::where('status', 'confirmed')->where('confirmed_at', '>=', now()->subDays(30))->select('id');
        $ranking = SaleLine::whereIn('sale_id', $recent)->groupBy('variant_id')->selectRaw('variant_id, COUNT(*) AS n')
            ->orderByDesc('n')->orderBy('variant_id')->limit(24)->pluck('variant_id');
        $variants = self::activeVariants()->where('products.status', 'active')->whereIn('product_variants.id', $ranking)
            ->get(['product_variants.*'])->keyBy('id');
        $ordered = $ranking->map(fn ($id) => $variants[$id] ?? null)->filter()->take(12)->values();

        return $this->json($this->itemDtos($ordered, $actor));
    }

    /** Búsqueda exacta por código de barras o SKU (lector del POS y de los formularios de stock). */
    public function lookup(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $q = Input::validate($request->query(), ['code' => ['required', 'string', 'max:64']]);
        $barcode = Barcode::where('code', $q['code'])->first();
        $variant = $barcode ? ProductVariant::find($barcode->variant_id) : ProductVariant::where('sku', $q['code'])->where('status', 'active')->first();
        if (! $variant) {
            throw AppError::notFound('Código');
        }

        return $this->json(['item' => $this->itemDtos(collect([$variant]), $actor)[0], 'quantityFactor' => $barcode ? Money::quantity($barcode->quantity_factor) : '1.000']);
    }

    /**
     * Códigos de barras internos para las variantes que no tienen (ADR 0014): EAN-13 con prefijo
     * 29, reservado para uso dentro del comercio, así no choca con códigos de fábrica. Devuelve las
     * variantes pedidas, con o sin código nuevo, listas para imprimir etiquetas.
     */
    public function generateBarcodes(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'variantIds' => ['required', 'array', 'list', 'min:1', 'max:500'],
            'variantIds.*' => ['required', 'string', 'uuid', 'distinct'],
        ]);
        $generated = DB::transaction(function () use ($actor, $v) {
            // Serializa por comercio: dos pedidos a la vez no toman el mismo número.
            $this->entitlements->lockTenant($actor->tenantId);
            $missing = ProductVariant::whereIn('id', $v['variantIds'])->where('status', 'active')
                ->whereNotIn('id', Barcode::whereIn('variant_id', $v['variantIds'])->select('variant_id'))->orderBy('product_id')->orderBy('label')->get();
            $last = Barcode::where('code', 'like', '29%')->whereRaw('CHAR_LENGTH(code) = 13')->max('code');
            $next = $last === null ? 1 : (int) substr($last, 2, 10) + 1;
            $rows = [];
            $now = now()->format('Y-m-d H:i:s.u');
            foreach ($missing as $variant) {
                $code = self::ean13('29'.str_pad((string) $next++, 10, '0', STR_PAD_LEFT));
                $rows[] = ['id' => (string) Str::uuid7(), 'variant_id' => $variant->id, 'code' => $code, 'quantity_factor' => '1.000', 'created_at' => $now];
            }
            Barcode::insertForTenant($rows);
            foreach ($missing->groupBy('product_id') as $productId => $variants) {
                $codes = $variants->mapWithKeys(fn ($variant) => [$variant->label ?? '—' => collect($rows)->firstWhere('variant_id', $variant->id)['code']])->all();
                $this->record($actor, 'product.barcodes_generated', $productId, null, ['barcodes' => $codes]);
            }

            return count($rows);
        });
        $variants = ProductVariant::whereIn('id', $v['variantIds'])->get()->sortBy(fn ($x) => array_search($x->id, $v['variantIds'], true))->values();

        return $this->json(['generated' => $generated, 'items' => $this->itemDtos($variants, $actor)]);
    }

    /** Agrega el dígito verificador a los 12 primeros dígitos de un EAN-13. */
    public static function ean13(string $twelve): string
    {
        $sum = 0;
        foreach (str_split($twelve) as $i => $digit) {
            $sum += (int) $digit * ($i % 2 === 0 ? 1 : 3);
        }

        return $twelve.((10 - $sum % 10) % 10);
    }

    /** Sugerencia del catálogo de referencia (SEPA) para un código que el comercio todavía no cargó. */
    public function reference(Request $request): JsonResponse
    {
        $q = Input::validate($request->query(), ['code' => ['required', 'string', 'max:64']]);
        $key = ReferenceProduct::key($q['code']);
        $found = $key === null ? null : ReferenceProduct::find($key);
        if (! $found) {
            throw AppError::notFound('Código');
        }

        return $this->json(['code' => $q['code'], 'name' => $found->name, 'brandName' => $found->brand, 'presentation' => $found->presentation, 'source' => $found->source]);
    }

    public function history(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        Product::find($id) ?? throw AppError::notFound('Producto');
        $labels = ProductVariant::where('product_id', $id)->pluck('label', 'id');
        $prices = VariantPrice::whereIn('variant_id', $labels->keys())->orderByDesc('valid_from')->limit(100)->get();
        $costs = $actor->can('costs.read') ? VariantCost::whereIn('variant_id', $labels->keys())->orderByDesc('at')->limit(100)->get() : collect();
        $users = User::whereIn('id', $prices->pluck('changed_by')->merge($costs->pluck('changed_by'))->filter()->unique())->pluck('name', 'id');
        $changes = AuditEntry::where('tenant_id', $actor->tenantId)->where('entity_type', 'product')->where('entity_id', $id)
            ->orderByDesc('at')->limit(100)->get();

        return $this->json([
            'prices' => $prices->map(fn (VariantPrice $p) => [
                'variantLabel' => $labels[$p->variant_id] ?? null,
                'price' => $p->price, 'validFrom' => Dates::iso($p->valid_from), 'validTo' => Dates::iso($p->valid_to),
                'changedBy' => $users[$p->changed_by] ?? null, 'batchId' => $p->batch_id,
            ])->all(),
            'costs' => $costs->map(fn (VariantCost $c) => [
                'variantLabel' => $labels[$c->variant_id] ?? null,
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
        foreach ($input['variants'] as $v) {
            if ($v['cost'] !== null && ! $actor->can('costs.update')) {
                throw AppError::forbidden('costs.update');
            }
            if ($v['initialStock'] !== null && ! BigDecimal::of($v['initialStock'])->isZero() && ! $actor->can('stock.adjust')) {
                throw AppError::forbidden('stock.adjust');
            }
        }

        $id = $this->guardUnique(fn () => DB::transaction(function () use ($actor, $input) {
            $this->entitlements->lockTenant($actor->tenantId);
            $this->entitlements->assertBelowLimit('max_products', Product::where('status', 'active')->count());
            $this->assertVariantsAllowed($input, null);
            $this->assertReferences($input);
            $this->assertCodesFree($input['variants'], []);

            return $this->createProduct($actor, $input);
        }));

        return $this->json($this->dto($id, $actor), 201);
    }

    /** Búsqueda en el catálogo de referencia (SEPA) por nombre, marca o código, marcando lo que el comercio ya tiene. */
    public function referenceSearch(Request $request): JsonResponse
    {
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), ['q' => ['nullable', 'string', 'max:100']]);
        $term = trim($q['q'] ?? '');
        $query = ReferenceProduct::query();
        if (preg_match('/^\d{6,14}$/', $term)) {
            $query->whereKey(ReferenceProduct::key($term) ?? '');
        } else {
            foreach (array_filter(explode(' ', $term)) as $word) {
                $like = self::like($word);
                $query->where(fn ($w) => $w->where('name', 'like', $like)->orWhere('brand', 'like', $like));
            }
        }
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('seen_in')->orderBy('name')->orderBy('code')->forPage($page, $pageSize)->get();
        $taken = Barcode::whereIn('code', $rows->flatMap(fn (ReferenceProduct $r) => ReferenceProduct::spellings($r->code)))->pluck('code')
            ->map(fn ($c) => ReferenceProduct::key($c))->flip();

        return $this->json([
            'items' => $rows->map(fn (ReferenceProduct $r) => [
                'code' => ReferenceProduct::barcode($r->code), 'name' => $r->name, 'brandName' => $r->brand, 'presentation' => $r->presentation,
                'source' => $r->source, 'added' => isset($taken[$r->code]),
            ])->values()->all(),
            'total' => $total, 'page' => $page, 'pageSize' => $pageSize,
        ]);
    }

    /**
     * Alta de varios productos del catálogo de referencia, con precio y stock inicial.
     * Quedan como cualquier alta manual: activos, IVA 21 % y por unidad.
     */
    public function addFromReference(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'categoryId' => ['present', 'nullable', 'string', 'uuid'],
            'items' => ['required', 'array', 'list', 'min:1', 'max:100'],
            'items.*' => ['array'],
            'items.*.code' => ['required', 'string', 'regex:/^\d{6,14}$/', 'distinct'],
            'items.*.price' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'items.*.initialStock' => ['nullable', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
        ], [
            'items.min' => 'Elegí al menos un producto',
            'items.max' => 'Hasta 100 productos por vez',
            'items.*.code.regex' => 'Código inválido',
            'items.*.code.distinct' => 'Código repetido',
        ]);
        $refs = ReferenceProduct::whereIn('code', array_map(fn ($i) => ReferenceProduct::key($i['code']) ?? '', $v['items']))->get()->keyBy('code');
        $details = [];
        foreach ($v['items'] as $i => $item) {
            if (isset($item['initialStock']) && BigDecimal::of($item['initialStock'])->hasNonZeroFractionalPart()) {
                $details[] = ['path' => "items.{$i}.initialStock", 'message' => 'En la venta por unidad, la cantidad tiene que ser entera'];
            }
            if (isset($item['initialStock']) && ! BigDecimal::of($item['initialStock'])->isZero() && ! $actor->can('stock.adjust')) {
                throw AppError::forbidden('stock.adjust');
            }
            if (! isset($refs[ReferenceProduct::key($item['code']) ?? ''])) {
                $details[] = ['path' => "items.{$i}.code", 'message' => 'No está en el catálogo'];
            }
        }
        if ($details !== []) {
            throw AppError::validation($details);
        }

        $ids = $this->guardUnique(fn () => DB::transaction(function () use ($actor, $v, $refs) {
            $this->entitlements->lockTenant($actor->tenantId);
            $active = Product::where('status', 'active')->count();
            $this->entitlements->assertBelowLimit('max_products', $active + count($v['items']) - 1);
            $brands = Brand::pluck('id', 'name')->mapWithKeys(fn ($id, $name) => [mb_strtolower($name) => $id])->all();
            $ids = [];
            foreach ($v['items'] as $item) {
                $ref = $refs[ReferenceProduct::key($item['code'])];
                $brandId = null;
                if ($ref->brand !== null) {
                    $brandId = $brands[mb_strtolower($ref->brand)] ??= $this->createBrand($actor, $ref->brand);
                }
                $input = [
                    'kind' => 'good', 'name' => $ref->name, 'description' => null, 'categoryId' => $v['categoryId'] ?? null, 'brandId' => $brandId,
                    'saleMode' => 'unit', 'vatRate' => '21', 'trackStock' => true, 'minStock' => null, 'blockNegativeStock' => false,
                    'optionNames' => [],
                    'variants' => [[
                        'id' => null, 'options' => [], 'label' => null, 'sku' => null, 'price' => Money::round($item['price']), 'cost' => null,
                        'barcodes' => [['code' => ReferenceProduct::barcode($ref->code), 'quantityFactor' => '1.000']],
                        'initialStock' => isset($item['initialStock']) ? Money::quantity($item['initialStock']) : null,
                    ]],
                ];
                $this->assertReferences($input);
                // El comercio puede tenerlo cargado con o sin ceros adelante.
                $this->assertCodesFree([['sku' => null, 'barcodes' => array_map(fn ($c) => ['code' => $c], ReferenceProduct::spellings($ref->code))]], []);
                $ids[] = $this->createProduct($actor, $input);
            }

            return $ids;
        }));

        return $this->json(['created' => count($ids)], 201);
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
            $existing = ProductVariant::where('product_id', $id)->orderBy('created_at')->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $active = $existing->where('status', 'active');
            $before = $this->auditView($this->currentInput($product, $active));
            $this->assertVariantsAllowed($input, $product);

            // Una combinación quitada que se vuelve a cargar recupera su variante, con su historial.
            foreach ($input['variants'] as &$v) {
                $v['isNew'] = $v['id'] === null;
                if ($v['id'] !== null && ! $existing->has($v['id'])) {
                    throw AppError::notFound('Variante');
                }
                if ($v['id'] === null && $v['label'] !== null) {
                    $v['id'] = $existing->first(fn (ProductVariant $e) => $e->status === 'inactive' && $e->label !== null
                        && mb_strtolower($e->label) === mb_strtolower($v['label']))?->id;
                }
            }
            unset($v);
            $kept = array_flip(array_filter(array_column($input['variants'], 'id')));
            $removed = $active->reject(fn (ProductVariant $e) => isset($kept[$e->id]));

            $seeCost = $actor->can('costs.read');
            foreach ($input['variants'] as $i => $v) {
                $current = $v['id'] !== null ? $existing[$v['id']] : null;
                // Quien no ve costos no los puede pisar sin querer: se conserva el vigente.
                if (! $seeCost) {
                    $input['variants'][$i]['cost'] = $v['cost'] = $current?->cost === null ? null : Money::roundUnit($current->cost);
                }
                $priceChanges = $current !== null && ! BigDecimal::of($current->price)->isEqualTo($v['price']);
                $costChanges = $current === null
                    ? $v['cost'] !== null
                    : ($current->cost === null ? $v['cost'] !== null : ($v['cost'] === null || ! BigDecimal::of($current->cost)->isEqualTo($v['cost'])));
                if ($priceChanges && ! $actor->can('prices.update')) {
                    throw AppError::forbidden('prices.update');
                }
                if ($costChanges && ! $actor->can('costs.update')) {
                    throw AppError::forbidden('costs.update');
                }
                if ($v['initialStock'] !== null && ! BigDecimal::of($v['initialStock'])->isZero() && ! $actor->can('stock.adjust')) {
                    throw AppError::forbidden('stock.adjust');
                }
            }
            $withStock = fn (Collection $variants) => StockLevel::whereIn('variant_id', $variants->keys())->where('on_hand', '<>', 0)->value('variant_id');
            if ($product->track_stock && ! $input['trackStock'] && $withStock($active)) {
                throw AppError::conflict('STOCK_NOT_ZERO', 'Para dejar de controlar el stock, primero llevalo a cero con un ajuste.');
            }
            if ($product->track_stock && ($stocked = $withStock($removed))) {
                throw AppError::conflict('STOCK_NOT_ZERO', "Para quitar la variante {$existing[$stocked]->label}, primero llevá su stock a cero con un ajuste.");
            }
            $this->assertReferences($input);
            $this->assertCodesFree($input['variants'], $existing->keys()->all());

            $product->forceFill([...$this->masterColumns($input), 'option_names' => $input['optionNames'] ?: null, 'version' => $product->version + 1])->save();
            // Se liberan etiquetas, códigos internos y de barras del producto para reasignarlos sin chocar entre variantes.
            ProductVariant::where('product_id', $id)->update(['label' => null, 'sku' => null]);
            Barcode::whereIn('variant_id', $existing->keys())->delete();
            $finalLabels = array_flip(array_map(fn ($v) => mb_strtolower((string) $v['label']), $input['variants']));
            foreach ($removed as $e) {
                ProductVariant::whereKey($e->id)->update([
                    'status' => 'inactive', 'label' => $e->label !== null && ! isset($finalLabels[mb_strtolower($e->label)]) ? $e->label : null,
                ]);
            }
            $warehouse = null;
            foreach ($input['variants'] as $v) {
                if ($v['id'] === null) {
                    $variant = $this->createVariant($actor, $product->id, $v);
                } else {
                    $variant = $existing[$v['id']];
                    // Por consulta y no con save(): las columnas recién liberadas no figuran como modificadas en el modelo.
                    ProductVariant::whereKey($variant->id)->update([
                        'options' => $v['options'] ? json_encode($v['options'], JSON_UNESCAPED_UNICODE) : null, 'label' => $v['label'], 'sku' => $v['sku'], 'status' => 'active',
                    ]);
                    $this->products->setPrice($variant, $v['price'], $actor->userId);
                    $this->products->setCost($variant, $v['cost'], 'manual', $actor->userId);
                    $this->saveBarcodes($variant->id, $v['barcodes']);
                }
                if ($v['isNew'] && $input['trackStock'] && $v['initialStock'] !== null && ! BigDecimal::of($v['initialStock'])->isZero()) {
                    $warehouse ??= $this->defaultWarehouse();
                    $this->stock->apply(
                        [['warehouseId' => $warehouse->id, 'variantId' => $variant->id, 'type' => 'adjust', 'quantity' => $v['initialStock'], 'sourceLineId' => (string) Str::uuid7()]],
                        ['sourceType' => 'initial_stock', 'sourceId' => $product->id, 'reason' => 'Stock inicial', 'userId' => $actor->userId],
                    );
                }
            }
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
            $this->record($actor, $input['status'] === 'active' ? 'product.activated' : 'product.deactivated', $id, ['status' => $previous], ['status' => $input['status']]);
        });

        return $this->json($this->dto($id, $actor));
    }

    // ------------------------------------------------------------------ Consulta

    /** Filtro de texto de productos: cada palabra en el nombre o en una variante, o SKU / código de barras exacto. */
    public static function search(Builder $query, ?string $term): Builder
    {
        $term = trim((string) $term);
        if ($term === '') {
            return $query;
        }

        return $query->where(function ($w) use ($term) {
            $w->where(function ($all) use ($term) {
                foreach (self::words($term) as $word) {
                    $all->where(fn ($one) => self::matchName($one, 'products.name', $word)
                        ->orWhereIn('products.id', self::matchLabel(ProductVariant::where('status', 'active'), 'label', $word)->select('product_id')));
                }
            })
                ->orWhereIn('products.id', ProductVariant::where('sku', $term)->select('product_id'))
                ->orWhereIn('products.id', ProductVariant::whereIn('id', Barcode::where('code', $term)->select('variant_id'))->select('product_id'));
        });
    }

    /** Variantes activas con su producto (para filtrar y ordenar por columnas de products). */
    public static function activeVariants(): Builder
    {
        return ProductVariant::query()
            ->join('products', function ($j) {
                $j->on('products.tenant_id', '=', 'product_variants.tenant_id')->on('products.id', '=', 'product_variants.product_id');
            })
            ->where('product_variants.status', 'active');
    }

    /** Filtro de texto por variante sobre activeVariants(): cada palabra en el nombre o la etiqueta, o SKU / código exacto. */
    public static function searchVariants(Builder $query, ?string $term): Builder
    {
        $term = trim((string) $term);
        if ($term === '') {
            return $query;
        }

        return $query->where(function ($w) use ($term) {
            $w->where(function ($all) use ($term) {
                foreach (self::words($term) as $word) {
                    $all->where(fn ($one) => self::matchName($one, 'products.name', $word)
                        ->orWhere(fn ($label) => self::matchLabel($label, 'product_variants.label', $word)));
                }
            })
                ->orWhere('product_variants.sku', $term)
                ->orWhereIn('product_variants.id', Barcode::where('code', $term)->select('variant_id'));
        });
    }

    /** @return list<string> */
    private static function words(string $term): array
    {
        return array_values(array_filter(preg_split('/\s+/u', $term) ?: [], fn ($w) => $w !== ''));
    }

    private static function like(string $word): string
    {
        return '%'.self::escapeLike($word).'%';
    }

    private static function escapeLike(string $word): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $word);
    }

    /**
     * Palabra en el nombre: contenida si tiene 3 letras o más; si es más corta (talles como «M»
     * o «38»), al principio de una palabra, para que «m» no traiga todo lo que dice «remera».
     */
    private static function matchName($query, string $column, string $word)
    {
        $esc = self::escapeLike($word);

        return mb_strlen($word) >= 3
            ? $query->where($column, 'like', "%{$esc}%")
            : $query->where(fn ($w) => $w->where($column, 'like', "{$esc}%")->orWhere($column, 'like', "% {$esc}%"));
    }

    /** Palabra al principio de uno de los valores de la etiqueta («M / Rojo»). */
    private static function matchLabel($query, string $column, string $word)
    {
        $esc = self::escapeLike($word);

        return $query->where(fn ($w) => $w->where($column, 'like', "{$esc}%")->orWhere($column, 'like', "% / {$esc}%"));
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
        $variants = ProductVariant::whereIn('product_id', $products->pluck('id'))->where('status', 'active')
            ->orderBy('created_at')->orderBy('id')->get()->groupBy('product_id');
        $variantIds = $variants->flatten()->pluck('id');
        $categories = Category::whereIn('id', $products->pluck('category_id')->filter()->unique())->pluck('name', 'id');
        $brands = Brand::whereIn('id', $products->pluck('brand_id')->filter()->unique())->pluck('name', 'id');
        $barcodes = $this->barcodesOf($variantIds);
        $stock = $this->stockOf($variantIds, $actor);
        $seeCost = $actor->can('costs.read');
        $seeStock = $actor->can('stock.read');

        return $products->map(function (Product $p) use ($variants, $categories, $brands, $barcodes, $stock, $seeCost, $seeStock) {
            $own = collect($variants->get($p->id, []));
            $showStock = $p->track_stock && $seeStock;
            $total = $own->reduce(fn (BigDecimal $sum, ProductVariant $v) => $sum->plus((string) ($stock[$v->id] ?? '0')), BigDecimal::zero());

            return [
                'id' => $p->id,
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
                'optionNames' => $p->option_names ?? [],
                'variants' => $own->map(fn (ProductVariant $v) => [
                    'id' => $v->id,
                    'options' => $v->options ?? [],
                    'label' => $v->label,
                    'sku' => $v->sku,
                    'price' => Money::round($v->price),
                    'cost' => $seeCost && $v->cost !== null ? Money::roundUnit($v->cost) : null,
                    'barcodes' => $barcodes->get($v->id, []),
                    'stock' => $showStock ? Money::quantity($stock[$v->id] ?? '0') : null,
                ])->values()->all(),
                'stock' => $showStock ? Money::quantity($total) : null,
                'status' => $p->status,
                'version' => $p->version,
                'updatedAt' => Dates::iso($p->updated_at),
            ];
        })->values()->all();
    }

    /**
     * Forma de ItemDto: una variante con los datos del producto que hacen falta para venderla o contarla.
     *
     * @param  Collection<int, ProductVariant>  $variants
     */
    private function itemDtos(Collection $variants, Actor $actor): array
    {
        if ($variants->isEmpty()) {
            return [];
        }
        $products = Product::whereIn('id', $variants->pluck('product_id')->unique())->get()->keyBy('id');
        $barcodes = $this->barcodesOf($variants->pluck('id'));
        $stock = $this->stockOf($variants->pluck('id'), $actor);
        $seeStock = $actor->can('stock.read');
        $seeCost = $actor->can('costs.read');

        return $variants->map(function (ProductVariant $v) use ($products, $barcodes, $stock, $seeStock, $seeCost) {
            $p = $products[$v->product_id];

            return [
                'productId' => $p->id,
                'variantId' => $v->id,
                'name' => $p->name,
                'variantLabel' => $v->label,
                'kind' => $p->kind,
                'saleMode' => $p->sale_mode,
                'trackStock' => $p->track_stock,
                'minStock' => $p->min_stock === null ? null : Money::quantity($p->min_stock),
                'sku' => $v->sku,
                'price' => Money::round($v->price),
                'cost' => $seeCost && $v->cost !== null ? Money::roundUnit($v->cost) : null,
                'barcodes' => $barcodes->get($v->id, []),
                'stock' => $p->track_stock && $seeStock ? Money::quantity($stock[$v->id] ?? '0') : null,
                'status' => $p->status === 'active' && $v->status === 'active' ? 'active' : 'inactive',
            ];
        })->values()->all();
    }

    /** @return Collection<string, list<array{code: string, quantityFactor: string}>> por variante */
    private function barcodesOf(Collection $variantIds): Collection
    {
        return Barcode::whereIn('variant_id', $variantIds)->orderBy('created_at')->orderBy('code')->get()->groupBy('variant_id')
            ->map(fn ($list) => $list->map(fn (Barcode $b) => ['code' => $b->code, 'quantityFactor' => Money::quantity($b->quantity_factor)])->values()->all());
    }

    /** Stock sumado de todos los depósitos, por variante. Vacío si el usuario no puede verlo. */
    private function stockOf(Collection $variantIds, Actor $actor): Collection
    {
        return $actor->can('stock.read')
            ? StockLevel::whereIn('variant_id', $variantIds)->groupBy('variant_id')->selectRaw('variant_id, SUM(on_hand) AS total')->pluck('total', 'variant_id')
            : collect();
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
            'optionNames' => ['present', 'array', 'list', 'max:'.self::MAX_OPTIONS],
            'optionNames.*' => ['required', 'string', 'max:30'],
            'variants' => ['required', 'array', 'list', 'min:1', 'max:'.self::MAX_VARIANTS],
            'variants.*' => ['array'],
            'variants.*.id' => ['present', 'nullable', 'string', 'uuid'],
            'variants.*.options' => ['present', 'array', 'list', 'max:'.self::MAX_OPTIONS],
            'variants.*.options.*' => ['required', 'string', 'max:40'],
            'variants.*.sku' => ['nullable', 'string', 'max:60'],
            'variants.*.price' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'variants.*.cost' => ['present', 'nullable', ...Input::decimal(Input::COST, 'Costo inválido')],
            'variants.*.barcodes' => ['present', 'array', 'list', 'max:20'],
            'variants.*.barcodes.*' => ['array'],
            'variants.*.barcodes.*.code' => ['required', 'string', 'max:64', 'regex:/^[0-9A-Za-z.\-_\/]+$/'],
            'variants.*.barcodes.*.quantityFactor' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
            'variants.*.initialStock' => ['present', 'nullable', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
        ];
        if (! $creating) {
            $rules['version'] = ['required', 'integer', 'min:1'];
        }
        $v = Input::validate($data, $rules, [
            'optionNames.max' => 'Hasta '.self::MAX_OPTIONS.' propiedades',
            'variants.required' => 'Agregá al menos una variante',
            'variants.min' => 'Agregá al menos una variante',
            'variants.max' => 'Hasta '.self::MAX_VARIANTS.' variantes por producto',
            'variants.*.barcodes.*.code.regex' => 'Solo letras, números y . - _ /',
        ]);

        // Los servicios no tienen stock.
        $trackStock = $v['kind'] === 'good' && $v['trackStock'];
        $input = [
            'kind' => $v['kind'],
            'name' => $v['name'],
            'description' => $v['description'] ?? null,
            'categoryId' => $v['categoryId'] ?? null,
            'brandId' => $v['brandId'] ?? null,
            'saleMode' => $v['saleMode'],
            'vatRate' => $v['vatRate'],
            'trackStock' => $trackStock,
            'minStock' => isset($v['minStock']) ? Money::quantity($v['minStock']) : null,
            'blockNegativeStock' => (bool) $v['blockNegativeStock'],
            'optionNames' => array_values($v['optionNames']),
            'variants' => array_map(fn ($x) => [
                'id' => $x['id'] ?? null,
                'options' => array_values($x['options']),
                'label' => $x['options'] === [] ? null : implode(' / ', $x['options']),
                'sku' => $x['sku'] ?? null,
                'price' => Money::round($x['price']),
                'cost' => isset($x['cost']) ? Money::roundUnit($x['cost']) : null,
                'barcodes' => array_map(fn ($b) => ['code' => $b['code'], 'quantityFactor' => Money::quantity($b['quantityFactor'])], $x['barcodes']),
                'initialStock' => isset($x['initialStock']) ? Money::quantity($x['initialStock']) : null,
            ], $v['variants']),
        ];
        if (! $creating) {
            $input['version'] = (int) $v['version'];
        }

        // Las mismas reglas entre campos que refineProduct en packages/contracts.
        $details = [];
        $names = [];
        foreach ($input['optionNames'] as $i => $name) {
            if (isset($names[mb_strtolower($name)])) {
                $details[] = ['path' => "optionNames.{$i}", 'message' => 'Propiedad repetida'];
            }
            $names[mb_strtolower($name)] = true;
        }
        if ($input['optionNames'] === [] && count($input['variants']) > 1) {
            $details[] = ['path' => 'optionNames', 'message' => 'Para cargar variantes, agregá al menos una propiedad (talle, color…)'];
        }
        $combos = [];
        $skus = [];
        $codes = [];
        $unit = $input['saleMode'] === 'unit';
        $whole = 'En la venta por unidad, la cantidad tiene que ser entera';
        foreach ($input['variants'] as $i => $x) {
            if ($creating && $x['id'] !== null) {
                $details[] = ['path' => "variants.{$i}.id", 'message' => 'Identificador inválido'];
            }
            if (! $creating && $x['id'] !== null && $x['initialStock'] !== null) {
                $details[] = ['path' => "variants.{$i}.initialStock", 'message' => 'El stock de una variante existente se cambia con un ajuste'];
            }
            if (count($x['options']) !== count($input['optionNames'])) {
                $details[] = ['path' => "variants.{$i}.options", 'message' => 'Completá todas las propiedades'];
            } elseif ($x['label'] !== null) {
                $key = mb_strtolower(implode("\0", $x['options']));
                if (isset($combos[$key])) {
                    $details[] = ['path' => "variants.{$i}.options", 'message' => 'Esta combinación ya está cargada'];
                }
                $combos[$key] = true;
            }
            if ($x['sku'] !== null) {
                if (isset($skus[$x['sku']])) {
                    $details[] = ['path' => "variants.{$i}.sku", 'message' => 'Código repetido'];
                }
                $skus[$x['sku']] = true;
            }
            foreach ($x['barcodes'] as $j => $b) {
                if (isset($codes[$b['code']])) {
                    $details[] = ['path' => "variants.{$i}.barcodes.{$j}.code", 'message' => 'Código repetido'];
                }
                $codes[$b['code']] = true;
                if (BigDecimal::of($b['quantityFactor'])->isZero()) {
                    $details[] = ['path' => "variants.{$i}.barcodes.{$j}.quantityFactor", 'message' => 'Debe ser mayor a cero'];
                } elseif ($unit && BigDecimal::of($b['quantityFactor'])->hasNonZeroFractionalPart()) {
                    $details[] = ['path' => "variants.{$i}.barcodes.{$j}.quantityFactor", 'message' => $whole];
                }
            }
            if ($unit && $x['initialStock'] !== null && BigDecimal::of($x['initialStock'])->hasNonZeroFractionalPart()) {
                $details[] = ['path' => "variants.{$i}.initialStock", 'message' => $whole];
            }
        }
        if ($unit && $input['minStock'] !== null && BigDecimal::of($input['minStock'])->hasNonZeroFractionalPart()) {
            $details[] = ['path' => 'minStock', 'message' => $whole];
        }
        if ($details !== []) {
            throw AppError::validation($details);
        }
        if (! $trackStock) {
            foreach ($input['variants'] as &$x) {
                $x['initialStock'] = null;
            }
            unset($x);
        }

        return $input;
    }

    /**
     * Crear propiedades o variantes nuevas requiere la función «variants» del plan. Sin ella, se
     * pueden seguir editando y vendiendo las variantes que ya existen.
     */
    private function assertVariantsAllowed(array $input, ?Product $product): void
    {
        if ($input['optionNames'] === [] || in_array('variants', $this->entitlements->plan()['features'] ?? [], true)) {
            return;
        }
        $adds = $product === null || ($product->option_names ?? []) !== $input['optionNames']
            || collect($input['variants'])->contains(fn ($v) => $v['id'] === null);
        if ($adds) {
            throw AppError::badRequest('VARIANTS_PLAN', 'Tu plan no incluye productos con variantes (talles, colores…).');
        }
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

    /**
     * Código de barras y SKU únicos en el comercio, con un mensaje que dice dónde está el repetido.
     *
     * @param  list<array{sku: ?string, barcodes: list<array{code: string}>}>  $variants
     * @param  list<string>  $ownVariantIds  variantes del mismo producto, que se reasignan
     */
    private function assertCodesFree(array $variants, array $ownVariantIds): void
    {
        $codes = array_merge(...array_map(fn ($v) => array_column($v['barcodes'], 'code'), $variants));
        if ($codes !== []) {
            $taken = Barcode::whereIn('code', $codes)->whereNotIn('variant_id', $ownVariantIds)->get();
            if ($taken->isNotEmpty()) {
                $names = Product::whereIn('id', ProductVariant::whereIn('id', $taken->pluck('variant_id'))->select('product_id'))->pluck('name')->all();
                throw new AppError(409, 'BARCODE_DUPLICATE', 'El código '.$taken->first()->code.' ya está cargado en '.implode(', ', $names),
                    $taken->map(fn ($b) => ['code' => $b->code])->values()->all());
            }
        }
        $skus = array_values(array_filter(array_column($variants, 'sku')));
        if ($skus !== []) {
            $sku = ProductVariant::whereIn('sku', $skus)->whereNotIn('id', $ownVariantIds)->first();
            if ($sku) {
                throw AppError::conflict('SKU_DUPLICATE', "El código interno {$sku->sku} ya está cargado en ".Product::find($sku->product_id)?->name);
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
            if (str_contains($e->getMessage(), 'product_variants_product_label_uq')) {
                throw AppError::conflict('VARIANT_DUPLICATE', 'Hay dos variantes con la misma combinación');
            }
            throw $e;
        }
    }

    /** Crea el producto con sus variantes, precios, costos, códigos y stock inicial. Corre dentro de la transacción del llamador. */
    private function createProduct(Actor $actor, array $input): string
    {
        $product = Product::create([
            ...$this->masterColumns($input), 'option_names' => $input['optionNames'] ?: null, 'status' => 'active', 'created_by' => $actor->userId,
        ]);
        $warehouse = null;
        foreach ($input['variants'] as $v) {
            $variant = $this->createVariant($actor, $product->id, $v);
            $initial = $v['initialStock'];
            if ($initial !== null && $product->track_stock && ! BigDecimal::of($initial)->isZero()) {
                $warehouse ??= $this->defaultWarehouse();
                $this->stock->apply(
                    [['warehouseId' => $warehouse->id, 'variantId' => $variant->id, 'type' => 'adjust', 'quantity' => $initial, 'sourceLineId' => $variant->id]],
                    ['sourceType' => 'initial_stock', 'sourceId' => $product->id, 'reason' => 'Stock inicial', 'userId' => $actor->userId],
                );
            }
        }
        $this->record($actor, 'product.created', $product->id, null, $this->auditView($input));

        return $product->id;
    }

    /** Variante nueva con su precio, costo, códigos y saldos en cero. */
    private function createVariant(Actor $actor, string $productId, array $v): ProductVariant
    {
        $variant = ProductVariant::create([
            'product_id' => $productId, 'options' => $v['options'] ?: null, 'label' => $v['label'],
            'sku' => $v['sku'], 'price' => $v['price'], 'cost' => null,
        ]);
        $this->products->setPrice($variant, $v['price'], $actor->userId, initial: true);
        if ($v['cost'] !== null) {
            $this->products->setCost($variant, $v['cost'], 'initial', $actor->userId, initial: true);
        }
        $this->saveBarcodes($variant->id, $v['barcodes']);
        $this->stock->initVariant($variant->id);

        return $variant;
    }

    private function defaultWarehouse(): Warehouse
    {
        return Warehouse::where('is_default', true)->orderBy('created_at')->first() ?? throw AppError::notFound('Depósito');
    }

    /** Marca que viene del catálogo y el comercio todavía no tiene: se crea con su auditoría, como desde Categorías y marcas. */
    private function createBrand(Actor $actor, string $name): string
    {
        $brand = Brand::create(['name' => $name]);
        $this->audit->record([
            'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
            'action' => 'brand.created', 'entityType' => 'brand', 'entityId' => $brand->id, 'before' => null, 'after' => ['name' => $name],
            'ip' => $actor->ip, 'requestId' => $actor->requestId,
        ]);

        return $brand->id;
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

    /** @param  Collection<string, ProductVariant>  $variants  las activas */
    private function currentInput(Product $p, Collection $variants): array
    {
        $input = [];
        foreach (self::MASTER_FIELDS as $key => $column) {
            $input[$key] = $p->{$column};
        }
        $input['minStock'] = $p->min_stock === null ? null : Money::quantity($p->min_stock);
        $barcodes = Barcode::whereIn('variant_id', $variants->keys())->get()->groupBy('variant_id');

        return $input + [
            'optionNames' => $p->option_names ?? [],
            'variants' => $variants->map(fn (ProductVariant $v) => [
                'label' => $v->label,
                'sku' => $v->sku,
                'price' => Money::round($v->price),
                'cost' => $v->cost === null ? null : Money::roundUnit($v->cost),
                'barcodes' => collect($barcodes->get($v->id, []))
                    ->map(fn ($b) => ['code' => $b->code, 'quantityFactor' => Money::quantity($b->quantity_factor)])->all(),
            ])->values()->all(),
        ];
    }

    /**
     * Lo que se audita. Sin propiedades, la variante única va aplanada (sku, price, cost, barcodes),
     * igual que antes de las variantes; con propiedades, cada variante por su etiqueta.
     */
    private function auditView(array $input): array
    {
        $view = array_intersect_key($input, self::MASTER_FIELDS);
        $codes = function (array $barcodes): array {
            usort($barcodes, fn ($a, $b) => strcmp($a['code'], $b['code']));

            return array_map(fn ($b) => $b['code'].($b['quantityFactor'] !== '1.000' ? " ×{$b['quantityFactor']}" : ''), $barcodes);
        };
        if ($input['optionNames'] === []) {
            $v = $input['variants'][0];

            return $view + ['sku' => $v['sku'], 'price' => $v['price'], 'cost' => $v['cost'], 'barcodes' => $codes($v['barcodes'])];
        }
        $variants = [];
        foreach ($input['variants'] as $v) {
            $variants[$v['label']] = ['sku' => $v['sku'], 'price' => $v['price'], 'cost' => $v['cost'], 'barcodes' => $codes($v['barcodes'])];
        }
        ksort($variants);

        return $view + ['optionNames' => $input['optionNames'], 'variants' => $variants];
    }

    /** Solo los campos que cambiaron. @return array{0: array, 1: array} */
    private static function diff(array $before, array $after): array
    {
        $b = [];
        $a = [];
        foreach (array_keys($before + $after) as $key) {
            if (($before[$key] ?? null) !== ($after[$key] ?? null)) {
                $b[$key] = $before[$key] ?? null;
                $a[$key] = $after[$key] ?? null;
            }
        }

        return [$b, $a];
    }

    private function hideCosts(mixed $values, Actor $actor): mixed
    {
        if (is_array($values) && ! $actor->can('costs.read')) {
            unset($values['cost']);
            if (isset($values['variants']) && is_array($values['variants'])) {
                $values['variants'] = array_map(fn ($v) => is_array($v) ? array_diff_key($v, ['cost' => 1]) : $v, $values['variants']);
            }
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
