<?php

namespace App\Http\Controllers\Concerns;

use App\Auth\Actor;
use App\Models\Barcode;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\AppError;
use App\Support\Input;
use App\Support\Money;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Importación de productos desde una planilla (ADR 0022). La web lee el archivo y manda las
 * filas tal cual; acá se interpretan los números («1.250,50»), se agrupan las variantes por
 * nombre y se valida cada producto con las mismas reglas que el alta. Primero se pide una vista
 * previa (dryRun) y después se importa todo junto o nada.
 *
 * Una fila cuyo código de barras o código interno ya existe no crea nada: si se pide, actualiza
 * el precio y el costo de esa variante.
 */
trait ImportsProducts
{
    public const MAX_IMPORT_ROWS = 2000;

    private const IMPORT_TEXT = ['name' => 160, 'barcode' => 64, 'sku' => 60, 'price' => 30, 'cashPrice' => 30, 'cost' => 30, 'initialStock' => 30, 'minStock' => 30, 'category' => 80, 'brand' => 80, 'vatRate' => 20, 'saleMode' => 20, 'description' => 500];

    private const IMPORT_LABELS = [
        'name' => 'Nombre', 'description' => 'Descripción', 'saleMode' => 'Se vende por', 'vatRate' => 'IVA', 'minStock' => 'Stock mínimo',
        'price' => 'Precio', 'cashPrice' => 'Precio contado', 'cost' => 'Costo', 'initialStock' => 'Stock inicial', 'sku' => 'Código interno', 'barcodes' => 'Código de barras',
        'options' => 'Propiedades', 'optionNames' => 'Propiedades',
    ];

    public function import(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $rules = [
            'rows' => ['required', 'array', 'list', 'min:1', 'max:'.self::MAX_IMPORT_ROWS],
            'rows.*' => ['array'],
            'rows.*.row' => ['required', 'integer', 'min:1'],
            'rows.*.options' => ['present', 'array', 'list', 'max:'.self::MAX_OPTIONS],
            'rows.*.options.*' => ['nullable', 'string', 'max:40'],
            'optionNames' => ['present', 'array', 'list', 'max:'.self::MAX_OPTIONS],
            'optionNames.*' => ['required', 'string', 'max:30'],
            'updateExisting' => ['required', Input::strictBoolean()],
            'dryRun' => ['required', Input::strictBoolean()],
        ];
        foreach (self::IMPORT_TEXT as $field => $max) {
            $rules["rows.*.{$field}"] = ['nullable', 'string', "max:{$max}"];
        }
        $v = Input::validate($this->body($request), $rules, [
            'rows.max' => 'Hasta '.self::MAX_IMPORT_ROWS.' filas por importación: dividí la planilla en partes',
            'rows.min' => 'La planilla no tiene filas con datos',
            'optionNames.max' => 'Hasta '.self::MAX_OPTIONS.' propiedades de variantes (talle, color…)',
        ]);
        if ($v['updateExisting'] && ! $actor->can('products.update')) {
            throw AppError::forbidden('products.update');
        }

        if ($v['dryRun']) {
            return $this->json($this->importPlan($actor, $v)['report']);
        }

        $report = DB::transaction(function () use ($actor, $v) {
            $this->entitlements->lockTenant($actor->tenantId);
            $plan = $this->importPlan($actor, $v);
            if ($plan['report']['errors'] !== []) {
                throw new AppError(400, 'IMPORT_INVALID', 'La planilla tiene errores: corregilos y volvé a subirla', $plan['report']);
            }
            if ($plan['creates'] === [] && $plan['updates'] === []) {
                throw AppError::badRequest('NOTHING_TO_IMPORT', 'No hay nada para importar: todos los artículos ya existen sin cambios');
            }
            $this->applyImport($actor, $plan);

            return $plan['report'];
        });

        return $this->json($report);
    }

    /** @return array{report: array, creates: list<array>, updates: list<array>, newCategories: array<string, string>, newBrands: array<string, string>} */
    private function importPlan(Actor $actor, array $v): array
    {
        $optionNames = array_map('trim', $v['optionNames']);
        $errors = [];
        $warnings = [];
        $report = [];
        $canCost = $actor->can('costs.update');
        $canStock = $actor->can('stock.adjust');
        $rows = array_map(fn ($r) => ['row' => (int) $r['row'], 'options' => array_map(fn ($o) => trim((string) $o), $r['options'])]
            + array_map(fn ($f) => trim((string) ($r[$f] ?? '')), array_combine(array_keys(self::IMPORT_TEXT), array_keys(self::IMPORT_TEXT))), $v['rows']);
        if (! $canCost && collect($rows)->contains(fn ($r) => $r['cost'] !== '')) {
            $warnings[] = 'No tenés permiso para cargar costos: la columna Costo no se tiene en cuenta.';
        }
        if (! $canStock && collect($rows)->contains(fn ($r) => $r['initialStock'] !== '')) {
            $warnings[] = 'No tenés permiso para ajustar stock: la columna Stock inicial no se tiene en cuenta.';
        }

        // Códigos repetidos dentro de la misma planilla.
        foreach (['barcode' => 'código de barras', 'sku' => 'código interno'] as $field => $label) {
            $seen = [];
            foreach ($rows as $r) {
                if ($r[$field] === '') {
                    continue;
                }
                if (isset($seen[$r[$field]])) {
                    $errors[] = ['row' => $r['row'], 'message' => "El {$label} {$r[$field]} está repetido (también en la fila {$seen[$r[$field]]})"];
                }
                $seen[$r[$field]] ??= $r['row'];
            }
        }

        $byCode = Barcode::whereIn('code', array_values(array_filter(array_column($rows, 'barcode'))))->pluck('variant_id', 'code');
        $bySku = ProductVariant::whereIn('sku', array_values(array_filter(array_column($rows, 'sku'))))->pluck('id', 'sku');
        $existing = ProductVariant::whereIn('id', $byCode->values()->merge($bySku->values())->unique())->get()->keyBy('id');
        $productNames = Product::whereIn('id', $existing->pluck('product_id'))->pluck('name', 'id');
        $updates = [];
        $groups = [];
        $stockIgnored = 0;

        foreach ($rows as $r) {
            $variantId = ($r['barcode'] !== '' ? $byCode[$r['barcode']] ?? null : null) ?? ($r['sku'] !== '' ? $bySku[$r['sku']] ?? null : null);
            if ($variantId !== null) {
                $variant = $existing[$variantId];
                $name = ProductVariant::displayName($productNames[$variant->product_id] ?? '', $variant->label);
                $line = ['row' => $r['row'], 'name' => $name, 'variant' => null, 'price' => null, 'oldPrice' => Money::round($variant->price)];
                if (! $v['updateExisting']) {
                    $report[] = array_merge($line, ['action' => 'skip', 'detail' => 'Ya existe: no se modifica']);

                    continue;
                }
                $price = $r['price'] === '' ? null : self::importDecimal($r['price'], 2);
                $cost = $canCost && $r['cost'] !== '' ? self::importDecimal($r['cost'], 4) : null;
                $cashPrice = $r['cashPrice'] === '' ? null : self::importDecimal($r['cashPrice'], 2);
                $invalid = match (true) {
                    $r['price'] !== '' && ($price === null || ! preg_match(Input::MONEY, $price)) => "Precio inválido: {$r['price']}",
                    $r['cashPrice'] !== '' && ($cashPrice === null || ! preg_match(Input::MONEY, $cashPrice)) => "Precio contado inválido: {$r['cashPrice']}",
                    $canCost && $r['cost'] !== '' && ($cost === null || ! preg_match(Input::COST, $cost)) => "Costo inválido: {$r['cost']}",
                    $cashPrice !== null && BigDecimal::of($cashPrice)->isGreaterThan($price ?? $variant->price) => 'Precio contado: no puede ser mayor que el de lista',
                    default => null,
                };
                if ($invalid !== null) {
                    $errors[] = ['row' => $r['row'], 'message' => $invalid];
                    $report[] = array_merge($line, ['action' => 'error', 'detail' => null]);

                    continue;
                }
                $priceChanges = $price !== null && ! BigDecimal::of($variant->price)->isEqualTo($price);
                $costChanges = $cost !== null && ($variant->cost === null || ! BigDecimal::of($variant->cost)->isEqualTo($cost));
                // El contado igual al de lista se guarda como «sin precio de contado».
                $newCash = $cashPrice !== null && ! BigDecimal::of($cashPrice)->isEqualTo($price ?? $variant->price) ? $cashPrice : null;
                $cashChanges = $r['cashPrice'] !== '' && ($variant->cash_price === null ? $newCash !== null : ($newCash === null || ! BigDecimal::of($variant->cash_price)->isEqualTo($newCash)));
                $priceChanges = $priceChanges || $cashChanges;
                if ($r['initialStock'] !== '') {
                    $stockIgnored++;
                }
                if (! $priceChanges && ! $costChanges) {
                    $report[] = array_merge($line, ['action' => 'unchanged', 'price' => $line['oldPrice'], 'detail' => 'Ya existe con el mismo precio']);

                    continue;
                }
                $updates[] = ['variantId' => $variantId, 'price' => $price !== null && ! BigDecimal::of($variant->price)->isEqualTo($price) ? $price : null, 'cost' => $costChanges ? $cost : null, 'cashChanges' => $cashChanges, 'cashPrice' => $newCash];
                $report[] = array_merge($line, ['action' => 'update', 'price' => $price ?? $line['oldPrice'], 'detail' => $costChanges && ! $priceChanges ? 'Cambia el costo' : null]);

                continue;
            }
            if ($r['name'] === '') {
                $errors[] = ['row' => $r['row'], 'message' => 'Falta el nombre'];
                $report[] = ['row' => $r['row'], 'action' => 'error', 'name' => '', 'variant' => null, 'price' => null, 'oldPrice' => null, 'detail' => null];

                continue;
            }
            $groups[mb_strtolower($r['name'])][] = $r;
        }
        if ($stockIgnored > 0) {
            $warnings[] = "En {$stockIgnored} artículo(s) que ya existen no se toca el stock: para sumar mercadería usá Compras o un ajuste.";
        }

        // Productos nuevos: las filas con el mismo nombre son variantes de un producto.
        $categories = Category::all()->keyBy(fn ($c) => mb_strtolower($c->name));
        $brands = Brand::all()->keyBy(fn ($b) => mb_strtolower($b->name));
        $newCategories = [];
        $newBrands = [];
        $creates = [];
        foreach ($groups as $group) {
            $first = $group[0];
            $used = array_values(array_filter(array_keys($optionNames), fn ($i) => collect($group)->contains(fn ($r) => ($r['options'][$i] ?? '') !== '')));
            if (count($group) > 1 && $used === []) {
                foreach ($group as $r) {
                    $errors[] = ['row' => $r['row'], 'message' => "«{$first['name']}» aparece en varias filas: si son variantes, completá ".($optionNames ? implode(', ', $optionNames) : 'las columnas de talle, color…').'; si no, usá nombres distintos'];
                    $report[] = ['row' => $r['row'], 'action' => 'error', 'name' => $r['name'], 'variant' => null, 'price' => null, 'oldPrice' => null, 'detail' => null];
                }

                continue;
            }
            $category = $first['category'];
            if ($category !== '' && ! $categories->has(mb_strtolower($category))) {
                $newCategories[mb_strtolower($category)] ??= $category;
            }
            $brand = $first['brand'];
            if ($brand !== '' && ! $brands->has(mb_strtolower($brand))) {
                $newBrands[mb_strtolower($brand)] ??= $brand;
            }
            $saleMode = self::importSaleMode($first['saleMode']);
            $vatRate = self::importVatRate($first['vatRate']);
            $input = [
                'kind' => 'good', 'name' => $first['name'], 'description' => $first['description'] ?: null, 'categoryId' => null, 'brandId' => null,
                'saleMode' => $saleMode ?? $first['saleMode'], 'vatRate' => $vatRate ?? $first['vatRate'], 'trackStock' => true,
                'minStock' => $first['minStock'] === '' ? null : (self::importDecimal($first['minStock'], 3) ?? $first['minStock']), 'blockNegativeStock' => false,
                'optionNames' => array_map(fn ($i) => $optionNames[$i], $used),
                'variants' => array_map(fn ($r) => [
                    'id' => null,
                    'options' => array_map(fn ($i) => $r['options'][$i] ?? '', $used),
                    'sku' => $r['sku'] ?: null,
                    'price' => $r['price'] === '' ? null : (self::importDecimal($r['price'], 2) ?? $r['price']),
                    'cashPrice' => $r['cashPrice'] === '' ? null : (self::importDecimal($r['cashPrice'], 2) ?? $r['cashPrice']),
                    'cost' => $canCost && $r['cost'] !== '' ? (self::importDecimal($r['cost'], 4) ?? $r['cost']) : null,
                    'barcodes' => $r['barcode'] === '' ? [] : [['code' => $r['barcode'], 'quantityFactor' => '1']],
                    'initialStock' => $canStock && $r['initialStock'] !== '' ? (self::importDecimal($r['initialStock'], 3) ?? $r['initialStock']) : null,
                ], $group),
            ];
            // Una opción vacía se informa como «Completá todas las propiedades».
            foreach ($input['variants'] as &$variant) {
                if (in_array('', $variant['options'], true)) {
                    $variant['options'] = array_values(array_filter($variant['options'], fn ($o) => $o !== ''));
                }
            }
            unset($variant);
            try {
                $valid = $this->validated($input, true);
            } catch (AppError $e) {
                if ($e->errorCode !== 'VALIDATION_ERROR') {
                    throw $e;
                }
                foreach ((array) $e->details as $d) {
                    $errors[] = ['row' => self::importRowOf($d['path'], $group), 'message' => self::importMessage($d, $input)];
                }
                foreach ($group as $r) {
                    $report[] = ['row' => $r['row'], 'action' => 'error', 'name' => $r['name'], 'variant' => self::importVariantLabel($r, $used), 'price' => null, 'oldPrice' => null, 'detail' => null];
                }

                continue;
            }
            $valid['categoryKey'] = $category === '' ? null : mb_strtolower($category);
            $valid['brandKey'] = $brand === '' ? null : mb_strtolower($brand);
            $creates[] = $valid;
            foreach ($group as $i => $r) {
                $report[] = ['row' => $r['row'], 'action' => 'create', 'name' => $r['name'], 'variant' => self::importVariantLabel($r, $used), 'price' => $valid['variants'][$i]['price'], 'oldPrice' => null, 'detail' => null];
            }
        }

        // Límites del plan: productos y variantes.
        $plan = $this->entitlements->plan();
        $limit = $plan['limits']['max_products'] ?? null;
        $current = Product::where('status', 'active')->count();
        if ($limit !== null && $current + count($creates) > $limit) {
            $errors[] = ['row' => null, 'message' => "Tu plan permite hasta {$limit} productos: ya tenés {$current} y la planilla suma ".count($creates).'.'];
        }
        if (collect($creates)->contains(fn ($c) => $c['optionNames'] !== []) && ! in_array('variants', $plan['features'] ?? [], true)) {
            $errors[] = ['row' => null, 'message' => 'Tu plan no incluye productos con variantes (talles, colores…).'];
        }

        usort($report, fn ($a, $b) => $a['row'] <=> $b['row']);
        usort($errors, fn ($a, $b) => ($a['row'] ?? 0) <=> ($b['row'] ?? 0));
        $count = fn (string $action) => count(array_filter($report, fn ($r) => $r['action'] === $action));

        return [
            'report' => [
                'summary' => ['products' => count($creates), 'variants' => $count('create'), 'updated' => $count('update'), 'unchanged' => $count('unchanged'), 'skipped' => $count('skip'), 'errors' => count($errors)],
                'newCategories' => array_values($newCategories),
                'newBrands' => array_values($newBrands),
                'warnings' => $warnings,
                'errors' => $errors,
                'rows' => $report,
            ],
            'creates' => $creates,
            'updates' => $updates,
            'newCategories' => $newCategories,
            'newBrands' => $newBrands,
        ];
    }

    private function applyImport(Actor $actor, array $plan): void
    {
        $categoryIds = Category::all()->mapWithKeys(fn ($c) => [mb_strtolower($c->name) => $c->id])->all();
        foreach ($plan['newCategories'] as $key => $name) {
            $category = Category::create(['name' => $name]);
            $this->audit->record([
                'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
                'action' => 'category.created', 'entityType' => 'category', 'entityId' => $category->id, 'before' => null, 'after' => ['name' => $name],
                'ip' => $actor->ip, 'requestId' => $actor->requestId,
            ]);
            $categoryIds[$key] = $category->id;
        }
        $brandIds = Brand::all()->mapWithKeys(fn ($b) => [mb_strtolower($b->name) => $b->id])->all();
        foreach ($plan['newBrands'] as $key => $name) {
            $brandIds[$key] = $this->createBrand($actor, $name);
        }
        $this->guardUnique(function () use ($actor, $plan, $categoryIds, $brandIds) {
            $this->assertCodesFree(array_merge(...array_map(fn ($c) => $c['variants'], $plan['creates']) ?: [[]]), []);
            foreach ($plan['creates'] as $input) {
                $input['categoryId'] = $input['categoryKey'] ? $categoryIds[$input['categoryKey']] : null;
                $input['brandId'] = $input['brandKey'] ? $brandIds[$input['brandKey']] : null;
                unset($input['categoryKey'], $input['brandKey']);
                $this->createProduct($actor, $input);
            }
        });
        $variants = ProductVariant::whereIn('id', array_column($plan['updates'], 'variantId'))->lockForUpdate()->get()->keyBy('id');
        foreach ($plan['updates'] as $u) {
            $variant = $variants[$u['variantId']];
            $before = ['price' => Money::round($variant->price), 'cost' => $variant->cost === null ? null : Money::roundUnit($variant->cost)];
            if ($u['price'] !== null) {
                $this->products->setPrice($variant, $u['price'], $actor->userId);
            }
            if ($u['cost'] !== null) {
                $this->products->setCost($variant, $u['cost'], 'import', $actor->userId);
            }
            if ($u['cashChanges']) {
                $before['cashPrice'] = $variant->cash_price === null ? null : Money::round($variant->cash_price);
                $variant->forceFill(['cash_price' => $u['cashPrice']])->save();
            }
            $this->record($actor, 'product.updated', $variant->product_id, $before, array_filter(['variantId' => $variant->id, 'price' => $u['price'], 'cost' => $u['cost']], fn ($x) => $x !== null)
                + ($u['cashChanges'] ? ['cashPrice' => $u['cashPrice']] : []));
        }
        $s = $plan['report']['summary'];
        $this->audit->record([
            'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
            'action' => 'products.imported', 'entityType' => 'tenant', 'entityId' => $actor->tenantId, 'before' => null,
            'after' => ['products' => $s['products'], 'variants' => $s['variants'], 'updated' => $s['updated'], 'categories' => array_values($plan['newCategories']), 'brands' => array_values($plan['newBrands'])],
            'ip' => $actor->ip, 'requestId' => $actor->requestId,
        ]);
    }

    /**
     * Número de una celda: «1250,5», «$ 1.250,50», «1.250» (miles) o «1250.5» (como lo guarda
     * Excel). Se redondea a los decimales del campo; null si no es un número.
     */
    public static function importDecimal(string $raw, int $scale): ?string
    {
        $s = str_replace(['$', ' ', "\u{00A0}"], '', trim($raw));
        if (str_contains($s, ',') && str_contains($s, '.')) {
            $s = strrpos($s, ',') > strrpos($s, '.') ? str_replace(['.', ','], ['', '.'], $s) : str_replace(',', '', $s);
        } elseif (str_contains($s, ',')) {
            $s = preg_match('/^\d{1,3}(,\d{3}){2,}$/', $s) ? str_replace(',', '', $s) : str_replace(',', '.', $s);
        } elseif (preg_match('/^\d{1,3}(\.\d{3})+$/', $s)) {
            $s = str_replace('.', '', $s);
        }
        if (! preg_match('/^\d+(\.\d+)?$/', $s)) {
            return null;
        }

        return (string) BigDecimal::of($s)->toScale($scale, RoundingMode::HALF_UP);
    }

    private static function importSaleMode(string $raw): ?string
    {
        $s = self::importKey($raw);

        return match (true) {
            $s === '' || in_array($s, ['unidad', 'unidades', 'u', 'un', 'unit'], true) => 'unit',
            in_array($s, ['kg', 'kilo', 'kilos', 'peso', 'kilogramo', 'kilogramos', 'weight'], true) => 'weight',
            in_array($s, ['m', 'metro', 'metros', 'length'], true) => 'length',
            in_array($s, ['l', 'lt', 'litro', 'litros', 'volume'], true) => 'volume',
            default => null,
        };
    }

    private static function importVatRate(string $raw): ?string
    {
        $s = str_replace(['%', ' '], '', self::importKey($raw));
        $s = str_replace(',', '.', $s);
        if ($s === '') {
            return '21';
        }
        if ($s === 'nogravado') {
            return 'no_gravado';
        }
        $s = preg_match('/^\d+(\.\d+)?$/', $s) ? rtrim(rtrim(number_format((float) $s, 1, '.', ''), '0'), '.') : $s;

        return in_array($s, self::VAT_RATES, true) ? $s : null;
    }

    private static function importKey(string $raw): string
    {
        return mb_strtolower(trim(strtr($raw, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ú' => 'u'])));
    }

    /** Fila de la planilla a la que corresponde un error del producto («variants.2.price» → la tercera fila del grupo). */
    private static function importRowOf(string $path, array $group): int
    {
        return preg_match('/^variants\.(\d+)\./', $path, $m) && isset($group[(int) $m[1]]) ? $group[(int) $m[1]]['row'] : $group[0]['row'];
    }

    private static function importMessage(array $detail, array $input): string
    {
        $field = preg_match('/^variants\.\d+\.(\w+)/', $detail['path'], $m) ? $m[1] : explode('.', $detail['path'])[0];
        $message = $detail['message'];
        if ($field === 'saleMode') {
            $message = "«{$input['saleMode']}» no es válido: usá unidad, kg, metro o litro";
        } elseif ($field === 'vatRate') {
            $message = "«{$input['vatRate']}» no es válido: usá 21, 10,5, 27, 5, 2,5, 0, exento o no gravado";
        } elseif ($field === 'price' && str_contains(mb_strtolower($message), 'obligatorio')) {
            $message = 'Falta el precio';
        }

        return (self::IMPORT_LABELS[$field] ?? ucfirst($field)).': '.$message;
    }

    private static function importVariantLabel(array $row, array $used): ?string
    {
        $values = array_values(array_filter(array_map(fn ($i) => $row['options'][$i] ?? '', $used)));

        return $values === [] ? null : implode(' / ', $values);
    }
}
