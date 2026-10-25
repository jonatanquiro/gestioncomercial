<?php

namespace App\Http\Controllers;

use App\Models\AuditEntry;
use App\Support\Dates;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Auditoría del comercio activo. AuditEntry no usa BelongsToTenant: se filtra acá por tenant_id. */
class AuditController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), ['entityType' => ['nullable', 'string', 'max:40']]);

        $query = AuditEntry::where('tenant_id', $actor->tenantId)
            ->when($q['entityType'] ?? null, fn ($w, $type) => $w->where('entity_type', $type));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('at')->orderByDesc('id')->forPage($page, $pageSize)->get();

        return $this->json([
            'items' => $rows->map(fn (AuditEntry $r) => [
                'id' => $r->id,
                'at' => Dates::iso($r->at),
                'actorName' => $r->actor_name,
                'action' => $r->action,
                'entityType' => $r->entity_type,
                'entityId' => $r->entity_id,
                'before' => $r->before,
                'after' => $r->after,
                'ip' => $r->ip,
            ])->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }
}
