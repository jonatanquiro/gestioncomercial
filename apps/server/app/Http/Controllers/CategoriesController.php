<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\Brand;
use App\Models\Category;
use App\Models\Product;
use App\Services\AuditService;
use App\Support\AppError;
use App\Support\Input;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Categorías (las iniciales salen del rubro) y marcas. Nunca se borran: una categoría se desactiva. */
class CategoriesController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(): JsonResponse
    {
        $counts = Product::where('status', 'active')->whereNotNull('category_id')->groupBy('category_id')
            ->selectRaw('category_id, COUNT(*) AS n')->pluck('n', 'category_id');

        return $this->json(Category::orderBy('name')->get()->map(fn (Category $c) => [
            'id' => $c->id, 'name' => $c->name, 'status' => $c->status, 'productCount' => (int) ($counts[$c->id] ?? 0),
        ])->all());
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), ['name' => ['required', 'string', 'max:80']]);

        $category = $this->unique('Ya existe una categoría con ese nombre', fn () => DB::transaction(function () use ($actor, $input) {
            $category = Category::create(['name' => $input['name']]);
            $this->record($actor, 'category.created', 'category', $category->id, null, ['name' => $input['name']]);

            return $category;
        }));

        return $this->json(['id' => $category->id, 'name' => $category->name, 'status' => 'active', 'productCount' => 0], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:80'],
            'status' => ['required', 'string', 'in:active,inactive'],
        ]);

        $this->unique('Ya existe una categoría con ese nombre', fn () => DB::transaction(function () use ($actor, $id, $input) {
            $category = Category::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Categoría');
            $before = ['name' => $category->name, 'status' => $category->status];
            $category->fill($input)->save();
            $this->record($actor, 'category.updated', 'category', $id, $before, $input);
        }));

        return $this->json(['ok' => true]);
    }

    public function brands(): JsonResponse
    {
        return $this->json(Brand::orderBy('name')->get(['id', 'name'])->map(fn (Brand $b) => ['id' => $b->id, 'name' => $b->name])->all());
    }

    public function storeBrand(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), ['name' => ['required', 'string', 'max:80']]);

        $brand = $this->unique('Ya existe una marca con ese nombre', fn () => DB::transaction(function () use ($actor, $input) {
            $brand = Brand::create(['name' => $input['name']]);
            $this->record($actor, 'brand.created', 'brand', $brand->id, null, ['name' => $input['name']]);

            return $brand;
        }));

        return $this->json(['id' => $brand->id, 'name' => $brand->name], 201);
    }

    private function unique(string $message, \Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (UniqueConstraintViolationException) {
            throw AppError::conflict('NAME_TAKEN', $message);
        }
    }

    private function record(Actor $actor, string $action, string $type, string $id, ?array $before, ?array $after): void
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
