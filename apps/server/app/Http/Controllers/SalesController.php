<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Mail\SaleReceiptMail;
use App\Models\Branch;
use App\Models\Customer;
use App\Models\FiscalInvoice;
use App\Models\GiftCard;
use App\Models\PaymentMethod;
use App\Models\Promotion;
use App\Models\Register;
use App\Models\Sale;
use App\Models\SaleLine;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\SaleReturnLine;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AuditService;
use App\Services\GiftCardService;
use App\Services\PromotionService;
use App\Services\SalesService;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Money;
use App\Support\Throttle;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/** Ventas del punto de venta: cobro, historial, anulación y devolución (sección 7 del diseño). */
class SalesController extends Controller
{
    public function __construct(private readonly SalesService $sales, private readonly AuditService $audit) {}

    public function store(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'registerId' => ['required', 'string', 'uuid'],
            ...self::saleRules(),
        ], self::saleMessages());
        self::assertSaleAmounts($input);
        ['sale' => $sale, 'created' => $created] = $this->sales->create($actor, $input);

        return $this->json($this->dto($sale, $actor), $created ? 201 : 200);
    }

    /** Venta de una gift card (ADR 0015): una venta sin artículos por el monto de la tarjeta. */
    public function storeGiftCard(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'registerId' => ['required', 'string', 'uuid'],
            'amount' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'validMonths' => ['required', 'integer', 'min:1', 'max:'.GiftCardService::MAX_MONTHS],
            'recipientName' => ['nullable', 'string', 'max:80'],
            'fromName' => ['nullable', 'string', 'max:80'],
            'message' => ['nullable', 'string', 'max:200'],
            ...array_intersect_key(self::saleRules(), array_flip(['payments', 'payments.*', 'payments.*.paymentMethodId', 'payments.*.amount', 'payments.*.reference', 'payments.*.payerName', 'payments.*.payerPhone'])),
        ], [
            'validMonths.min' => 'La validez va de 1 a '.GiftCardService::MAX_MONTHS.' meses',
            'validMonths.max' => 'La validez va de 1 a '.GiftCardService::MAX_MONTHS.' meses',
            ...self::saleMessages(),
        ]);
        if (Money::of($input['amount'])->isZero()) {
            throw AppError::validation([['path' => 'amount', 'message' => 'El importe no puede ser cero']]);
        }
        self::assertSaleAmounts(['lines' => [], 'payments' => $input['payments']]);
        ['sale' => $sale, 'created' => $created] = $this->sales->issueGiftCard($actor, $input);

        return $this->json($this->dto($sale, $actor), $created ? 201 : 200);
    }

    /** Cobro de la deuda de un cliente (ADR 0016): una venta sin artículos que entra a la caja. */
    public function storeAccountPayment(Request $request, string $customerId): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'registerId' => ['required', 'string', 'uuid'],
            'amount' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            ...array_intersect_key(self::saleRules(), array_flip(['payments', 'payments.*', 'payments.*.paymentMethodId', 'payments.*.amount', 'payments.*.reference', 'payments.*.payerName', 'payments.*.payerPhone'])),
        ], self::saleMessages());
        if (Money::of($input['amount'])->isZero()) {
            throw AppError::validation([['path' => 'amount', 'message' => 'El importe no puede ser cero']]);
        }
        self::assertSaleAmounts(['lines' => [], 'payments' => $input['payments']]);
        Customer::whereKey($customerId)->exists() || throw AppError::notFound('Cliente');
        ['sale' => $sale, 'created' => $created] = $this->sales->collectAccount($actor, $customerId, $input);

        return $this->json($this->dto($sale, $actor), $created ? 201 : 200);
    }

    /**
     * Total de la venta en curso con las promociones vigentes (ADR 0020): la caja lo muestra y lo
     * manda como expectedTotal, así el total que ve el cajero es el que se cobra.
     */
    public function quote(Request $request): JsonResponse
    {
        $input = Input::validate($this->body($request), array_intersect_key(self::saleRules(), array_flip(['lines', 'lines.*', 'lines.*.variantId', 'lines.*.quantity', 'lines.*.discountPercent'])), self::saleMessages());
        self::assertSaleAmounts(['lines' => $input['lines'], 'payments' => []]);
        ['lines' => $lines, 'subtotal' => $subtotal, 'discountTotal' => $discount, 'total' => $total] = $this->sales->price($input['lines']);

        return $this->json([
            'lines' => array_map(fn ($l) => [
                'variantId' => $l['variant']->id, 'unitPrice' => Money::round($l['variant']->price), 'promotionId' => $l['promotion']?->id,
                'promotionName' => $l['promotion']?->name, 'promotionDiscount' => $l['promotionDiscount'], 'total' => $l['lineTotal'],
            ], $lines),
            'subtotal' => Money::round($subtotal), 'discountTotal' => Money::round($discount), 'total' => Money::round($total),
        ]);
    }

    /** Promociones vigentes, para mostrarlas en la caja y saber si hace falta cotizar. */
    public function activePromotions(): JsonResponse
    {
        return $this->json(app(PromotionService::class)->active()->map(fn (Promotion $p) => ['id' => $p->id, 'name' => $p->name])->values()->all());
    }

    public function index(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'shiftId' => ['nullable', 'string', 'uuid'],
            'customerId' => ['nullable', 'string', 'uuid'],
            'number' => ['nullable', 'integer', 'min:1'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
        ]);
        $query = $this->visible($actor)
            ->when($q['shiftId'] ?? null, fn ($w, $id) => $w->where('shift_id', $id))
            ->when($q['customerId'] ?? null, fn ($w, $id) => $w->where('customer_id', $id))
            ->when($q['number'] ?? null, fn ($w, $n) => $w->where('number', (int) $n))
            ->when($q['from'] ?? null, fn ($w, $d) => $w->where('confirmed_at', '>=', "{$d} 00:00:00"))
            ->when($q['to'] ?? null, fn ($w, $d) => $w->where('confirmed_at', '<=', "{$d} 23:59:59.999999"));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('confirmed_at')->orderByDesc('id')->forPage($page, $pageSize)->get();
        $users = User::whereIn('id', $rows->pluck('cashier_id')->unique())->pluck('name', 'id');
        $registers = Register::whereIn('id', $rows->pluck('register_id')->unique())->pluck('name', 'id');
        $returned = SaleReturn::whereIn('sale_id', $rows->pluck('id'))->groupBy('sale_id')->selectRaw('sale_id, SUM(total) AS total')->pluck('total', 'sale_id');
        $giftCards = GiftCard::whereIn('sale_id', $rows->pluck('id'))->pluck('code', 'sale_id');
        $customers = Customer::whereIn('id', $rows->pluck('customer_id')->filter()->unique())->pluck('name', 'id');

        return $this->json([
            'items' => $rows->map(fn (Sale $s) => [
                'id' => $s->id,
                'number' => $s->number,
                'status' => $s->status,
                'confirmedAt' => Dates::iso($s->confirmed_at),
                'cashierName' => $users[$s->cashier_id] ?? '',
                'registerName' => $registers[$s->register_id] ?? '',
                'total' => Money::round($s->total),
                'returnedTotal' => Money::round((string) ($returned[$s->id] ?? '0')),
                'giftCardCode' => $giftCards[$s->id] ?? null,
                'kind' => $s->kind,
                'customerName' => $customers[$s->customer_id] ?? null,
            ])->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $sale = $this->visible($actor)->whereKey($id)->first() ?? throw AppError::notFound('Venta');

        return $this->json($this->dto($sale, $actor));
    }

    public function void(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'reason' => ['required', 'string', 'max:200'],
            'authorization' => ['nullable', 'array'],
        ]);
        $this->visible($actor)->whereKey($id)->exists() || throw AppError::notFound('Venta');
        $sale = $this->sales->void($actor, $id, trim($input['reason']), $input['authorization'] ?? null);

        return $this->json($this->dto($sale, $actor));
    }

    public function storeReturn(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'registerId' => ['required', 'string', 'uuid'],
            'reason' => ['required', 'string', 'max:200'],
            'paymentMethodId' => ['required', 'string', 'uuid'],
            'lines' => ['required', 'array', 'list', 'min:1', 'max:300'],
            'lines.*' => ['array'],
            'lines.*.saleLineId' => ['required', 'string', 'uuid', 'distinct'],
            'lines.*.quantity' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
            'lines.*.restock' => ['present', Input::strictBoolean()],
            'authorization' => ['nullable', 'array'],
        ], ['lines.required' => 'Elegí qué se devuelve', 'lines.min' => 'Elegí qué se devuelve']);
        foreach ($input['lines'] as $i => $line) {
            if (Money::of($line['quantity'])->isZero()) {
                throw AppError::validation([['path' => "lines.{$i}.quantity", 'message' => 'La cantidad no puede ser cero']]);
            }
        }
        $this->visible($actor)->whereKey($id)->exists() || throw AppError::notFound('Venta');
        $input['reason'] = trim($input['reason']);
        ['created' => $created] = $this->sales->return($actor, $id, $input);

        return $this->json($this->dto(Sale::find($id), $actor), $created ? 201 : 200);
    }

    /** Cambio de talle o de artículo: devuelve líneas de esta venta y cobra una venta nueva con ese crédito. */
    public function storeExchange(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $input = Input::validate($this->body($request), [
            'clientUuid' => ['required', 'string', 'uuid'],
            'registerId' => ['required', 'string', 'uuid'],
            'reason' => ['required', 'string', 'max:180'],
            'returnLines' => ['required', 'array', 'list', 'min:1', 'max:300'],
            'returnLines.*' => ['array'],
            'returnLines.*.saleLineId' => ['required', 'string', 'uuid', 'distinct'],
            'returnLines.*.quantity' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
            'returnLines.*.restock' => ['present', Input::strictBoolean()],
            ...self::saleRules(),
        ], [
            'returnLines.required' => 'Elegí qué se devuelve', 'returnLines.min' => 'Elegí qué se devuelve',
            ...self::saleMessages(),
        ]);
        foreach ($input['returnLines'] as $i => $line) {
            if (Money::of($line['quantity'])->isZero()) {
                throw AppError::validation([['path' => "returnLines.{$i}.quantity", 'message' => 'La cantidad no puede ser cero']]);
            }
        }
        self::assertSaleAmounts($input);
        $this->visible($actor)->whereKey($id)->exists() || throw AppError::notFound('Venta');
        $input['reason'] = trim($input['reason']);
        ['sale' => $sale, 'created' => $created] = $this->sales->exchange($actor, $id, $input);

        return $this->json($this->dto($sale, $actor), $created ? 201 : 200);
    }

    /** Artículos y pagos de una venta: los mismos límites que createSaleSchema. */
    private static function saleRules(): array
    {
        return [
            'lines' => ['required', 'array', 'list', 'min:1', 'max:300'],
            'lines.*' => ['array'],
            'lines.*.variantId' => ['required', 'string', 'uuid', 'distinct'],
            'lines.*.quantity' => ['required', ...Input::decimal(Input::QUANTITY, 'Cantidad inválida')],
            'lines.*.discountPercent' => ['nullable', ...Input::decimal(Input::PERCENT, 'Descuento inválido')],
            'customerId' => ['nullable', 'string', 'uuid'],
            'accountAmount' => ['nullable', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'payments' => ['present', 'array', 'list', 'max:10'],
            'payments.*' => ['array'],
            'payments.*.paymentMethodId' => ['required', 'string', 'uuid'],
            'payments.*.amount' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'payments.*.reference' => ['nullable', 'string', 'max:80'],
            'payments.*.payerName' => ['nullable', 'string', 'max:120'],
            'payments.*.payerPhone' => ['nullable', 'string', 'regex:/^[\d\s()+-]{6,30}$/'],
            'giftCards' => ['nullable', 'array', 'list', 'max:5'],
            'giftCards.*' => ['array'],
            'giftCards.*.code' => ['required', 'string', 'max:30', 'distinct'],
            'giftCards.*.amount' => ['required', ...Input::decimal(Input::MONEY, 'Importe inválido')],
            'expectedTotal' => ['required', ...Input::decimal(Input::MONEY, 'Total inválido')],
            'authorization' => ['nullable', 'array'],
        ];
    }

    private static function saleMessages(): array
    {
        return ['giftCards.*.code.distinct' => 'La gift card está repetida', 'payments.*.payerPhone.regex' => 'Teléfono inválido', 'lines.required' => 'Agregá al menos un artículo', 'lines.min' => 'Agregá al menos un artículo', 'lines.*.variantId.distinct' => 'El artículo está repetido'];
    }

    private static function assertSaleAmounts(array $input): void
    {
        $details = [];
        foreach ($input['lines'] as $i => $line) {
            if (Money::of($line['quantity'])->isZero()) {
                $details[] = ['path' => "lines.{$i}.quantity", 'message' => 'La cantidad no puede ser cero'];
            }
            if (Money::of($line['discountPercent'] ?? '0')->isGreaterThan(100)) {
                $details[] = ['path' => "lines.{$i}.discountPercent", 'message' => 'El descuento no puede superar el 100%'];
            }
        }
        foreach ($input['payments'] as $i => $p) {
            if (Money::of($p['amount'])->isZero()) {
                $details[] = ['path' => "payments.{$i}.amount", 'message' => 'El importe no puede ser cero'];
            }
        }
        foreach ($input['giftCards'] ?? [] as $i => $g) {
            if (Money::of($g['amount'])->isZero()) {
                $details[] = ['path' => "giftCards.{$i}.amount", 'message' => 'El importe no puede ser cero'];
            }
        }
        if ($details !== []) {
            throw AppError::validation($details);
        }
    }

    /**
     * Manda el comprobante por email: el ticket o, con permiso fiscal, la factura autorizada. El
     * email no queda en la venta; solo se guarda en la ficha del cliente si se pide.
     */
    public function email(Request $request, string $id): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'email' => ['required', 'string', 'email', 'max:254'],
            'invoiceId' => ['nullable', 'string', 'uuid'],
            'saveToCustomer' => ['nullable', 'boolean'],
        ]);
        $sale = $this->visible($actor)->whereKey($id)->first() ?? throw AppError::notFound('Venta');
        $email = mb_strtolower(trim($v['email']));
        $invoice = null;
        if ($v['invoiceId'] ?? null) {
            if (! $actor->can('fiscal.issue') && ! $actor->can('fiscal.manage')) {
                throw AppError::forbidden('fiscal.issue');
            }
            $invoice = FiscalInvoice::whereKey($v['invoiceId'])->where('sale_id', $sale->id)->where('kind', 'invoice')->where('status', 'authorized')->first()
                ?? throw AppError::notFound('Factura');
        }
        $saveToCustomer = ($v['saveToCustomer'] ?? false) && $sale->customer_id && $actor->can('customers.manage');
        // Que nadie use el sistema para mandar correos en cantidad desde nuestro dominio.
        Throttle::consume("sale-email:{$actor->tenantId}", 150, 3600);

        $tenant = Tenant::find($actor->tenantId);
        $shop = ['tradeName' => $tenant->trade_name, 'address' => $tenant->address, 'phone' => $tenant->phone, 'email' => $tenant->email];
        try {
            Mail::to($email)->send(new SaleReceiptMail($shop, $this->dto($sale, $actor), $invoice ? self::invoiceForMail($invoice) : null));
        } catch (\Throwable $e) {
            report($e);
            throw new AppError(502, 'MAIL_FAILED', 'No se pudo enviar el email. Revisá la dirección o probá de nuevo en un rato.');
        }

        DB::transaction(function () use ($actor, $sale, $email, $invoice, $saveToCustomer) {
            if ($saveToCustomer) {
                $customer = Customer::whereKey($sale->customer_id)->lockForUpdate()->first();
                if ($customer && $customer->email !== $email) {
                    $before = ['email' => $customer->email];
                    $customer->forceFill(['email' => $email])->save();
                    $this->record($actor, 'customer.updated', 'customer', $customer->id, $before, ['email' => $email]);
                }
            }
            $this->record($actor, 'sale.emailed', 'sale', $sale->id, null, ['email' => $email, 'invoiceId' => $invoice?->id]);
        });

        return $this->json(['sent' => true, 'email' => $email]);
    }

    /** Lo que muestra el email de una factura, con el enlace del QR de ARCA. */
    private static function invoiceForMail(FiscalInvoice $i): array
    {
        $r = $i->payload['request'] ?? [];
        $date = (string) ($r['CbteFch'] ?? '');
        $qr = [
            'ver' => 1, 'fecha' => substr($date, 0, 4).'-'.substr($date, 4, 2).'-'.substr($date, 6, 2), 'cuit' => (int) $i->cuit,
            'ptoVta' => $i->point_of_sale, 'tipoCmp' => $i->voucher_type, 'nroCmp' => $i->number, 'importe' => (float) ($r['ImpTotal'] ?? 0),
            'moneda' => 'PES', 'ctz' => 1, 'tipoDocRec' => (int) ($r['DocTipo'] ?? 99), 'nroDocRec' => (int) ($r['DocNro'] ?? 0), 'tipoCodAut' => 'E', 'codAut' => (int) $i->cae,
        ];
        $condition = $i->payload['issuerTaxCondition'] ?? null;

        return [
            'title' => [1 => 'Factura A', 6 => 'Factura B', 11 => 'Factura C'][$i->voucher_type] ?? 'Factura',
            'number' => str_pad((string) $i->point_of_sale, 5, '0', STR_PAD_LEFT).'-'.str_pad((string) $i->number, 8, '0', STR_PAD_LEFT),
            'date' => substr($date, 6, 2).'/'.substr($date, 4, 2).'/'.substr($date, 0, 4),
            'test' => $i->environment !== 'produccion',
            'cuit' => $i->cuit,
            'issuerName' => $i->payload['issuerName'] ?? '',
            'issuerAddress' => $i->payload['issuerAddress'] ?? null,
            'issuerTaxCondition' => $condition === 'responsable_inscripto' ? 'IVA Responsable Inscripto' : ($condition === 'exento' ? 'IVA Exento' : 'Responsable Monotributo'),
            'buyerName' => $i->payload['buyerName'] ?? 'Consumidor final',
            'showVat' => $i->voucher_type === 1,
            'transparency' => $i->voucher_type !== 11,
            'net' => (string) ($r['ImpNeto'] ?? '0'),
            'vat' => (string) ($r['ImpIVA'] ?? '0'),
            'total' => (string) ($r['ImpTotal'] ?? '0'),
            'cae' => $i->cae,
            'caeExpiresOn' => $i->cae_expires_on,
            'arcaUrl' => 'https://www.arca.gob.ar/fe/qr/?p='.rawurlencode(base64_encode(json_encode($qr))),
        ];
    }

    private function record(Actor $actor, string $action, string $entityType, string $id, ?array $before, ?array $after): void
    {
        $this->audit->record([
            'tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName,
            'action' => $action, 'entityType' => $entityType, 'entityId' => $id, 'before' => $before, 'after' => $after,
            'ip' => $actor->ip, 'requestId' => $actor->requestId,
        ]);
    }

    /** Sin sales.read_all, cada uno ve solo sus ventas. */
    private function visible(Actor $actor)
    {
        return Sale::query()->when(! $actor->can('sales.read_all'), fn ($w) => $w->where('cashier_id', $actor->userId));
    }

    /** Forma de SaleDto: lo necesario para el detalle y para imprimir el ticket. */
    private function dto(Sale $sale, Actor $actor): array
    {
        $lines = SaleLine::where('sale_id', $sale->id)->orderBy('line_no')->get();
        $promotionNames = Promotion::whereIn('id', $lines->pluck('promotion_id')->filter()->unique())->pluck('name', 'id');
        $payments = SalePayment::where('sale_id', $sale->id)->get();
        $returns = SaleReturn::where('sale_id', $sale->id)->orderBy('created_at')->get();
        $returnLines = SaleReturnLine::whereIn('return_id', $returns->pluck('id'))->get()->groupBy('return_id');
        $methods = PaymentMethod::whereIn('id', $payments->pluck('payment_method_id')->merge($returns->pluck('payment_method_id')))->pluck('name', 'id');
        $userIds = collect([$sale->cashier_id, $sale->voided_by, $sale->void_authorized_by, $sale->discount_authorized_by])
            ->merge($returns->pluck('user_id'))->merge($returns->pluck('authorized_by'))->filter()->unique();
        $users = User::whereIn('id', $userIds)->pluck('name', 'id');
        $register = Register::find($sale->register_id);
        $seeCost = $actor->can('costs.read');
        // Cambios: de qué venta salió el crédito de esta, y por qué venta se cambió cada devolución.
        $origin = $sale->exchange_return_id ? SaleReturn::find($sale->exchange_return_id) : null;
        $exchangedFor = Sale::whereIn('exchange_return_id', $returns->pluck('id'))->get(['id', 'number', 'exchange_return_id'])->keyBy('exchange_return_id');
        $giftCard = GiftCard::where('sale_id', $sale->id)->first();

        return [
            'id' => $sale->id,
            'number' => $sale->number,
            'status' => $sale->status,
            'confirmedAt' => Dates::iso($sale->confirmed_at),
            'branchName' => Branch::find($sale->branch_id)?->name ?? '',
            'registerId' => $sale->register_id,
            'registerName' => $register?->name ?? '',
            'shiftId' => $sale->shift_id,
            'cashierName' => $users[$sale->cashier_id] ?? '',
            'subtotal' => Money::round($sale->subtotal),
            'discountTotal' => Money::round($sale->discount_total),
            'total' => Money::round($sale->total),
            'changeGiven' => Money::round($sale->change_given),
            'discountAuthorizedBy' => $users[$sale->discount_authorized_by] ?? null,
            'kind' => $sale->kind,
            'customer' => $sale->customer_id ? (fn (?Customer $c) => $c ? CustomersController::dto($c) : null)(Customer::find($sale->customer_id)) : null,
            'giftCard' => $giftCard ? GiftCardsController::dto($giftCard) : null,
            'exchangeOf' => $origin ? ['saleId' => $origin->sale_id, 'saleNumber' => (int) Sale::whereKey($origin->sale_id)->value('number'), 'credit' => Money::round($origin->total)] : null,
            'lines' => $lines->map(fn (SaleLine $l) => [
                'id' => $l->id,
                'variantId' => $l->variant_id,
                'description' => $l->description,
                'saleMode' => $l->sale_mode,
                'quantity' => Money::quantity($l->quantity),
                'unitPrice' => Money::round($l->unit_price),
                'unitCost' => $seeCost && $l->unit_cost !== null ? Money::roundUnit($l->unit_cost) : null,
                'discountPercent' => Money::round($l->discount_percent),
                'discountAmount' => Money::round($l->discount_amount),
                'promotionName' => $promotionNames[$l->promotion_id] ?? null,
                'promotionDiscount' => Money::round($l->promotion_discount),
                'vatRate' => $l->vat_rate,
                'total' => Money::round($l->line_total),
                'returnedQuantity' => Money::quantity($l->returned_quantity),
            ])->all(),
            'payments' => $payments->map(fn (SalePayment $p) => [
                'paymentMethodId' => $p->payment_method_id,
                'name' => $methods[$p->payment_method_id] ?? '',
                'kind' => $p->kind,
                'amount' => Money::round($p->amount),
                'reference' => $p->reference,
                'payerName' => $p->payer_name,
                'payerPhone' => $p->payer_phone,
            ])->all(),
            'void' => $sale->status === 'voided' ? [
                'at' => Dates::iso($sale->voided_at),
                'byName' => $users[$sale->voided_by] ?? '',
                'authorizedByName' => $users[$sale->void_authorized_by] ?? null,
                'reason' => $sale->void_reason,
            ] : null,
            'returns' => $returns->map(fn (SaleReturn $r) => [
                'id' => $r->id,
                'number' => (int) $r->number,
                'createdAt' => Dates::iso($r->created_at),
                'total' => Money::round($r->total),
                'giftCardAmount' => Money::round($r->gift_card_amount),
                'accountAmount' => Money::round($r->account_amount),
                'reason' => $r->reason,
                'paymentMethodName' => $methods[$r->payment_method_id] ?? '',
                'userName' => $users[$r->user_id] ?? '',
                'authorizedByName' => $users[$r->authorized_by] ?? null,
                'exchangeSale' => isset($exchangedFor[$r->id]) ? ['id' => $exchangedFor[$r->id]->id, 'number' => (int) $exchangedFor[$r->id]->number] : null,
                'lines' => ($returnLines[$r->id] ?? collect())->map(fn (SaleReturnLine $l) => [
                    'saleLineId' => $l->sale_line_id, 'quantity' => Money::quantity($l->quantity), 'amount' => Money::round($l->amount), 'restock' => (bool) $l->restock,
                ])->values()->all(),
            ])->all(),
        ];
    }
}
