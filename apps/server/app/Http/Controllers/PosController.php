<?php

namespace App\Http\Controllers;

use App\Services\AuditService;
use App\Services\PinAuthorization;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Autorización con PIN en el punto de venta (sección 6 del diseño). */
class PosController extends Controller
{
    /** Acciones que se pueden autorizar con PIN desde la caja. */
    public const AUTHORIZABLE = ['sales.void', 'sales.return', 'sales.discount_unlimited'];

    public function __construct(
        private readonly PinAuthorization $pins,
        private readonly AuditService $audit,
    ) {}

    public function authorizers(Request $request): JsonResponse
    {
        $q = Input::validate($request->query(), ['permission' => ['required', 'string', 'in:'.implode(',', self::AUTHORIZABLE)]]);

        return $this->json($this->pins->authorizers($q['permission']));
    }

    /** Cada uno carga o cambia su propio PIN confirmando la contraseña. */
    public function setPin(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'password' => ['required', 'string', 'max:200'],
            'pin' => ['required', 'string', 'regex:/^\d{4,6}$/'],
        ], ['pin.regex' => 'El PIN tiene que tener de 4 a 6 números']);
        DB::transaction(function () use ($actor, $input) {
            $this->pins->setPin($actor, $input['password'], $input['pin']);
            $this->audit->record([
                'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
                'action' => 'membership.pin_changed', 'entityType' => 'membership', 'entityId' => $actor->membershipId,
                'ip' => $actor->ip, 'requestId' => $actor->requestId,
            ]);
        });

        return $this->json(['ok' => true]);
    }
}
