<?php

namespace App\Http\Controllers;

use App\Models\Branch;
use App\Models\GiftCard;
use App\Models\GiftCardMovement;
use App\Models\Sale;
use App\Services\GiftCardService;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Gift cards emitidas, su saldo y cuánto le deben en total a los clientes (ADR 0015). */
class GiftCardsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'q' => ['nullable', 'string', 'max:80'],
            'state' => ['nullable', 'in:active,used,expired,voided'],
        ]);
        $today = GiftCardService::today();
        $term = trim((string) ($q['q'] ?? ''));
        $query = GiftCard::query()
            ->when($term !== '', fn ($w) => $w->where(fn ($x) => $x->where('code', 'like', '%'.GiftCardService::normalize($term).'%')
                ->orWhere('recipient_name', 'like', "%{$term}%")->orWhere('from_name', 'like', "%{$term}%")))
            ->when($q['state'] ?? null, fn ($w, $state) => match ($state) {
                'voided' => $w->where('status', 'voided'),
                'used' => $w->where('status', 'active')->where('balance', 0),
                'expired' => $w->where('status', 'active')->where('balance', '>', 0)->where('expires_on', '<', $today),
                default => $w->where('status', 'active')->where('balance', '>', 0)->where('expires_on', '>=', $today),
            });
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->orderByDesc('id')->forPage($page, $pageSize)->get();
        $outstanding = GiftCard::where('status', 'active')->where('balance', '>', 0)->where('expires_on', '>=', $today);

        return $this->json([
            'items' => $rows->map(fn (GiftCard $c) => self::dto($c))->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            // Saldo vigente: lo que el comercio todavía debe entregar en mercadería.
            'outstanding' => [
                'count' => (clone $outstanding)->count(),
                'amount' => Money::round((string) ((clone $outstanding)->selectRaw('SUM(balance) AS total')->value('total') ?? '0')),
            ],
        ]);
    }

    /** Saldo de una tarjeta por su código, para cobrar con ella o para consultarlo. */
    public function lookup(Request $request): JsonResponse
    {
        $q = Input::validate($request->query(), ['code' => ['required', 'string', 'max:30']]);
        $code = GiftCardService::normalize($q['code']);
        $card = GiftCard::where('code', $code)->first() ?? throw new AppError(404, 'NOT_FOUND', "No hay ninguna gift card con el código {$code}");

        return $this->json(self::dto($card, true));
    }

    /** Forma de GiftCardDto; con $movements, el detalle de cada uso. */
    public static function dto(GiftCard $c, bool $movements = false): array
    {
        $sale = Sale::find($c->sale_id, ['id', 'number']);
        $out = [
            'id' => $c->id,
            'code' => $c->code,
            'amount' => Money::round($c->amount),
            'balance' => Money::round($c->balance),
            'state' => GiftCardService::state($c),
            'expiresOn' => $c->expires_on->toDateString(),
            'recipientName' => $c->recipient_name,
            'fromName' => $c->from_name,
            'message' => $c->message,
            'createdAt' => Dates::iso($c->created_at),
            'branchName' => Branch::find($c->branch_id)?->name ?? '',
            'sale' => ['id' => $sale->id, 'number' => (int) $sale->number],
        ];
        if ($movements) {
            $rows = GiftCardMovement::where('gift_card_id', $c->id)->orderBy('created_at')->get();
            $numbers = Sale::whereIn('id', $rows->pluck('sale_id')->filter())->pluck('number', 'id');
            $out['movements'] = $rows->map(fn (GiftCardMovement $m) => [
                'kind' => $m->kind,
                'amount' => Money::round($m->amount),
                'balanceAfter' => Money::round($m->balance_after),
                'createdAt' => Dates::iso($m->created_at),
                'sale' => $m->sale_id ? ['id' => $m->sale_id, 'number' => (int) ($numbers[$m->sale_id] ?? 0)] : null,
            ])->all();
        }

        return $out;
    }
}
