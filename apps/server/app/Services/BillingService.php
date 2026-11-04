<?php

namespace App\Services;

use App\Auth\Actor;
use App\Mail\SubscriptionNoticeMail;
use App\Models\Membership;
use App\Models\Plan;
use App\Models\RolePermission;
use App\Models\Subscription;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\AppError;
use App\Support\Dates;
use App\Support\Money;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Cobro de la suscripción (ADR 0012). El estado se calcula en cada consulta a partir de las
 * fechas; un pago se acepta solo con lo que informa Mercado Pago, nunca con lo que trae el
 * navegador o el aviso. Todo corre con el comercio en contexto: el aviso automático lo toma
 * de la referencia externa del pago, que armamos nosotros al crear la preferencia.
 */
class BillingService
{
    public const GRACE_DAYS = 7;

    public const MONTH_OPTIONS = [1, 3, 6, 12];

    /** Separa estos cobros de los de otros sistemas que usan la misma cuenta de Mercado Pago. */
    public const REFERENCE_PREFIX = 'GC-';

    /** Pagos pendientes que se vuelven a consultar por si no llegó el aviso. */
    private const RECONCILE_DAYS = 3;

    /** Un comercio pausado hace más tiempo no recibe el aviso de pausa (por ejemplo, al poner precio a un plan). */
    private const PAUSED_NOTICE_DAYS = 7;

    private const STAGE_RANK = ['d7' => 1, 'd3' => 2, 'd1' => 3, 'due' => 4, 'paused' => 5];

    public function __construct(
        private readonly TenantContext $context,
        private readonly MercadoPagoClient $mp,
        private readonly AuditService $audit,
        private readonly EntitlementsService $entitlements,
    ) {}

    /**
     * free: sin vencimiento (licencia o plan sin precio) · trial · active · grace: vencida, todavía
     * opera · expired: pausada hasta que pague.
     *
     * @return array{state: string, dueAt: ?Carbon, blockAt: ?Carbon}
     */
    public static function evaluate(Subscription $s, Plan $plan, ?Carbon $now = null): array
    {
        if ($s->free_forever || Money::of((string) $plan->price)->isZero()) {
            return ['state' => 'free', 'dueAt' => null, 'blockAt' => null];
        }
        $now ??= Carbon::now();
        $paid = $s->current_period_end;
        $due = self::dueAt($s) ?? Carbon::parse($s->created_at);
        $block = $due->copy()->addDays(self::GRACE_DAYS);
        $state = match (true) {
            $paid !== null && $now->lte($paid) => 'active',
            $now->lte($due) => 'trial',
            $now->lte($block) => 'grace',
            default => 'expired',
        };

        return ['state' => $state, 'dueAt' => $due, 'blockAt' => $block];
    }

    /** Estado del comercio del contexto, con fechas ISO (forma de SubscriptionStateDto). */
    public function summary(): array
    {
        $s = $this->current();
        $plan = $s ? Plan::find($s->plan_id) : null;
        if (! $s || ! $plan) {
            return ['state' => 'free', 'dueAt' => null, 'blockAt' => null, 'freeForever' => false];
        }
        $e = self::evaluate($s, $plan);

        return ['state' => $e['state'], 'dueAt' => Dates::iso($e['dueAt']), 'blockAt' => Dates::iso($e['blockAt']), 'freeForever' => $s->free_forever];
    }

    public function blocked(): bool
    {
        return $this->summary()['state'] === 'expired';
    }

    /** Pantalla de suscripción del comercio (forma de SubscriptionDto). */
    public function overview(): array
    {
        $s = $this->current() ?? throw AppError::notFound('Suscripción vigente');
        $plans = Plan::with('limits')->where('active', true)->orderBy('sort_order')->get();
        $current = Plan::with('limits')->find($s->plan_id);
        $names = Plan::pluck('name', 'id');

        return $this->summary() + [
            'plan' => $current ? self::planDto($current) : null,
            'plans' => $plans->filter(fn (Plan $p) => ! Money::of((string) $p->price)->isZero())->map(fn (Plan $p) => self::planDto($p))->values()->all(),
            'monthOptions' => self::MONTH_OPTIONS,
            'graceDays' => self::GRACE_DAYS,
            'mercadoPago' => $this->mp->configured(),
            // Los pendientes se muestran solo si Mercado Pago ya los informó (por ejemplo, pago en efectivo sin acreditar).
            'payments' => SubscriptionPayment::where(fn ($w) => $w->whereIn('status', ['approved', 'refunded'])->orWhere(fn ($p) => $p->where('status', 'pending')->whereNotNull('mp_payment_id')))
                ->orderByDesc('created_at')->limit(24)->get()
                ->map(fn (SubscriptionPayment $p) => self::paymentDto($p, $names[$p->plan_id] ?? null))->all(),
        ];
    }

    /** Crea el pago y la preferencia de Mercado Pago. @return array{id: string, url: string} */
    public function startCheckout(Actor $actor, string $planCode, int $months): array
    {
        if (! $this->mp->configured()) {
            throw AppError::conflict('MP_NOT_CONFIGURED', 'El cobro con Mercado Pago no está configurado');
        }
        $plan = Plan::with('limits')->where('code', $planCode)->where('active', true)->first() ?? throw AppError::notFound('Plan activo');
        if (Money::of((string) $plan->price)->isZero()) {
            throw AppError::badRequest('PLAN_WITHOUT_PRICE', 'Ese plan no tiene precio: no hace falta pagarlo');
        }
        $s = $this->current() ?? throw AppError::notFound('Suscripción vigente');
        if ($s->free_forever) {
            throw AppError::conflict('SUBSCRIPTION_FREE', 'Tu licencia no tiene vencimiento: no hace falta pagar');
        }
        if ($plan->id !== $s->plan_id) {
            $this->entitlements->assertPlanFits($plan);
        }
        $amount = Money::round(Money::of((string) $plan->price)->multipliedBy($months));
        $payment = SubscriptionPayment::create([
            'plan_id' => $plan->id,
            'months' => $months,
            'amount' => $amount,
            'currency' => $plan->currency,
            'method' => 'mercadopago',
            'status' => 'pending',
            'created_by' => $actor->userId,
        ]);
        $tenant = Tenant::findOrFail($actor->tenantId);
        $reference = self::reference($actor->tenantId, $payment->id);
        $site = rtrim((string) config('app.url'), '/');
        $back = $site.'/app/suscripcion?pago='.$payment->id;
        $preference = [
            'items' => [[
                'id' => 'plan-'.$plan->code,
                'title' => mb_substr("Gestión Comercial · Plan {$plan->name} · ".self::monthsLabel($months)." · {$tenant->trade_name}", 0, 250),
                'quantity' => 1,
                'currency_id' => $plan->currency,
                // Mercado Pago recibe el importe como número JSON. El que vale se compara con BigDecimal al confirmar.
                'unit_price' => (float) $amount,
            ]],
            'external_reference' => $reference,
            'back_urls' => ['success' => $back, 'pending' => $back, 'failure' => $back],
            'statement_descriptor' => 'GESTION COMERCIAL',
        ];
        // Mercado Pago solo acepta la vuelta automática y los avisos en direcciones https (en la PC no se usan).
        if (str_starts_with($site, 'https://')) {
            $preference['auto_return'] = 'approved';
            $preference['notification_url'] = $site.'/api/v1/mercadopago/webhook';
        }
        try {
            $created = $this->mp->createPreference($preference, $reference);
        } catch (AppError $e) {
            $payment->forceFill(['status' => 'error', 'details' => ['error' => $e->errorCode]])->save();
            Log::error("Mercado Pago no creó la preferencia del pago {$payment->id}: {$e->getMessage()}");
            throw $e;
        }
        $payment->forceFill(['mp_preference_id' => $created['id']])->save();

        return ['id' => $payment->id, 'url' => $created['url']];
    }

    /**
     * Consulta un pago en Mercado Pago y deja la suscripción al día. Se puede llamar varias veces
     * por el mismo pago. Devuelve null si el pago no es de este sistema.
     */
    public function processMpPayment(string $mpPaymentId): ?SubscriptionPayment
    {
        if (! preg_match('/^\d{1,20}$/', $mpPaymentId)) {
            return null;
        }
        $data = $this->mp->payment($mpPaymentId);
        $ref = $data ? self::parseReference((string) ($data['external_reference'] ?? '')) : null;
        if ($ref === null || ! Tenant::whereKey($ref['tenantId'])->exists()) {
            return null;
        }

        return $this->context->run($ref['tenantId'], fn () => DB::transaction(fn () => $this->apply($ref['paymentId'], $mpPaymentId, $data)));
    }

    /** Vuelta desde Mercado Pago o consulta manual de un pago del comercio del contexto. */
    public function check(string $paymentId, ?string $mpPaymentId): SubscriptionPayment
    {
        $payment = SubscriptionPayment::find($paymentId) ?? throw AppError::notFound('Pago');
        if ($mpPaymentId !== null && $mpPaymentId !== '') {
            $processed = $this->processMpPayment($mpPaymentId);
            if ($processed && $processed->id === $payment->id) {
                return $processed;
            }
        }

        return $this->reconcile($payment);
    }

    /** Red de seguridad: busca en Mercado Pago, por la referencia, si un pago pendiente ya se acreditó. */
    public function reconcile(SubscriptionPayment $payment): SubscriptionPayment
    {
        if ($payment->method !== 'mercadopago' || ! in_array($payment->status, ['pending', 'rejected'], true) || ! $this->mp->configured()) {
            return $payment;
        }
        $found = $this->mp->searchByReference(self::reference($payment->tenant_id, $payment->id));
        usort($found, fn ($a, $b) => (($b['status'] ?? '') === 'approved') <=> (($a['status'] ?? '') === 'approved'));
        $first = $found[0] ?? null;
        if ($first && isset($first['id']) && ($first['external_reference'] ?? null) === self::reference($payment->tenant_id, $payment->id)) {
            return DB::transaction(fn () => $this->apply($payment->id, (string) $first['id'], $first)) ?? $payment;
        }
        $payment->forceFill(['checked_at' => Carbon::now()])->save();

        return $payment;
    }

    /** Pagos pendientes recientes del comercio del contexto. Lo corre el comando diario. */
    public function reconcilePending(): void
    {
        $pending = SubscriptionPayment::where('method', 'mercadopago')->where('status', 'pending')->whereNotNull('mp_preference_id')
            ->where('created_at', '>=', Carbon::now()->subDays(self::RECONCILE_DAYS))->get();
        foreach ($pending as $payment) {
            try {
                $this->reconcile($payment);
            } catch (AppError $e) {
                Log::warning("No se pudo revisar el pago {$payment->id} en Mercado Pago: {$e->getMessage()}");
            }
        }
    }

    /**
     * Pago recibido por otro medio (por ejemplo, transferencia), registrado desde la plataforma.
     *
     * @param  array{actorType: string, actorId: ?string, actorName: string, ip?: ?string, requestId?: ?string}  $by
     */
    public function recordManual(string $tenantId, int $months, string $amount, string $notes, array $by): SubscriptionPayment
    {
        return $this->context->run($tenantId, fn () => DB::transaction(function () use ($months, $amount, $notes, $by) {
            $s = $this->current() ?? throw AppError::notFound('Suscripción vigente');
            $payment = SubscriptionPayment::create([
                'plan_id' => $s->plan_id,
                'months' => $months,
                'amount' => Money::round($amount),
                'method' => 'manual',
                'status' => 'approved',
                'notes' => $notes,
            ]);
            $this->extend($payment, $by);

            return $payment;
        }));
    }

    /** @param  array{actorType: string, actorId: ?string, actorName: string, ip?: ?string, requestId?: ?string}  $by */
    public function setFreeForever(string $tenantId, bool $free, string $reason, array $by): void
    {
        $this->context->run($tenantId, fn () => DB::transaction(function () use ($tenantId, $free, $reason, $by) {
            $s = $this->current(lock: true) ?? throw AppError::notFound('Suscripción vigente');
            $before = $s->free_forever;
            $s->forceFill(['free_forever' => $free, 'notice_due_at' => null, 'notice_stage' => null])->save();
            $this->audit->record($by + [
                'tenantId' => $tenantId,
                'action' => 'platform.tenant_license_changed',
                'entityType' => 'subscription',
                'entityId' => $s->id,
                'before' => ['freeForever' => $before],
                'after' => ['freeForever' => $free, 'reason' => $reason],
            ]);
        }));
    }

    /**
     * Manda el aviso de vencimiento que corresponda hoy al comercio del contexto, una sola vez por
     * etapa. Devuelve la etapa enviada, o null si no correspondía ninguna.
     */
    public function sendNotice(): ?string
    {
        $s = $this->current();
        $plan = $s ? Plan::find($s->plan_id) : null;
        if (! $s || ! $plan) {
            return null;
        }
        $e = self::evaluate($s, $plan);
        $stage = self::noticeStage($e, Carbon::now());
        if ($stage === null) {
            return null;
        }
        $sameDue = $s->notice_due_at !== null && $s->notice_due_at->equalTo($e['dueAt']);
        if ($sameDue && (self::STAGE_RANK[$s->notice_stage] ?? 0) >= self::STAGE_RANK[$stage]) {
            return null;
        }
        $tenant = Tenant::findOrFail($this->context->id());
        $link = rtrim((string) config('app.url'), '/').'/app/suscripcion';
        try {
            foreach ($this->noticeRecipients() as $user) {
                Mail::to($user->email)->send(new SubscriptionNoticeMail(
                    $user->name, $tenant->trade_name, $stage, self::localDate($e['dueAt']), self::localDate($e['blockAt']), $link, $plan->name, Money::pesos((string) $plan->price),
                ));
            }
        } catch (Throwable $ex) {
            // Sin marcar el aviso: se vuelve a intentar en la próxima corrida.
            Log::error("No se pudo enviar el aviso de suscripción del comercio {$tenant->id}: {$ex->getMessage()}");

            return null;
        }
        $s->forceFill(['notice_due_at' => $e['dueAt'], 'notice_stage' => $stage])->save();

        return $stage;
    }

    /** @param  array{state: string, dueAt: ?Carbon, blockAt: ?Carbon}  $e */
    public static function noticeStage(array $e, Carbon $now): ?string
    {
        switch ($e['state']) {
            case 'trial':
            case 'active':
                $days = (int) ceil($now->diffInSeconds($e['dueAt']) / 86400);

                return match (true) {
                    $days <= 1 => 'd1',
                    $days <= 3 => 'd3',
                    $days <= 7 => 'd7',
                    default => null,
                };
            case 'grace':
                return 'due';
            case 'expired':
                return $e['blockAt']->gte($now->copy()->subDays(self::PAUSED_NOTICE_DAYS)) ? 'paused' : null;
            default:
                return null;
        }
    }

    public static function reference(string $tenantId, string $paymentId): string
    {
        return self::REFERENCE_PREFIX.$tenantId.'_'.$paymentId;
    }

    /** @return array{tenantId: string, paymentId: string}|null */
    public static function parseReference(string $reference): ?array
    {
        $uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
        if (! preg_match('/^'.preg_quote(self::REFERENCE_PREFIX, '/')."({$uuid})_({$uuid})$/", $reference, $m)) {
            return null;
        }

        return ['tenantId' => $m[1], 'paymentId' => $m[2]];
    }

    /** Forma de SubscriptionPaymentDto. */
    public static function paymentDto(SubscriptionPayment $p, ?string $planName): array
    {
        return [
            'id' => $p->id,
            'planName' => $planName,
            'months' => $p->months,
            'amount' => (string) $p->amount,
            'currency' => $p->currency,
            'method' => $p->method,
            'status' => $p->status,
            'periodFrom' => Dates::iso($p->period_from),
            'periodTo' => Dates::iso($p->period_to),
            'createdAt' => Dates::iso($p->created_at),
        ];
    }

    /**
     * Aplica lo que informó Mercado Pago sobre un pago. Un pago aprobado no vuelve atrás por un
     * aviso viejo: solo cambia si se reembolsa.
     *
     * @param  array<string, mixed>  $data
     */
    private function apply(string $paymentId, string $mpPaymentId, array $data): ?SubscriptionPayment
    {
        $payment = SubscriptionPayment::whereKey($paymentId)->lockForUpdate()->first();
        if (! $payment || $payment->method !== 'mercadopago') {
            return null;
        }
        $status = match ($data['status'] ?? '') {
            'approved' => 'approved',
            'rejected', 'cancelled' => 'rejected',
            'refunded', 'charged_back' => 'refunded',
            default => 'pending',
        };
        // Aprobado tiene que ser en la moneda y por el importe pedidos.
        if ($status === 'approved' && (($data['currency_id'] ?? null) !== $payment->currency
            || Money::of((string) ($data['transaction_amount'] ?? '0'))->isLessThan((string) $payment->amount))) {
            $status = 'rejected';
        }
        $details = array_intersect_key($data, array_flip(['status', 'status_detail', 'transaction_amount', 'currency_id', 'payment_method_id', 'date_approved']));
        $by = ['actorType' => 'system', 'actorId' => null, 'actorName' => 'Mercado Pago'];

        if ($payment->status === 'approved') {
            if ($status === 'refunded' && $payment->mp_payment_id === $mpPaymentId) {
                $payment->forceFill(['status' => 'refunded', 'details' => $details, 'checked_at' => Carbon::now()])->save();
                $this->revert($payment, $by);
            } elseif ($status === 'approved' && $payment->mp_payment_id !== $mpPaymentId) {
                Log::warning("El pago {$payment->id} ya estaba aprobado y Mercado Pago informó otro aprobado ({$mpPaymentId}): revisarlo y reembolsar uno.");
            }

            return $payment;
        }
        if ($payment->status === 'refunded') {
            return $payment;
        }
        $payment->forceFill(['status' => $status, 'mp_payment_id' => $mpPaymentId, 'details' => $details, 'checked_at' => Carbon::now()])->save();
        if ($status === 'approved') {
            $this->extend($payment, $by);
        }

        return $payment;
    }

    /**
     * Corre el vencimiento los meses pagados. Si se paga en la prueba o en la gracia, el período
     * arranca en el vencimiento; si ya estaba pausada, arranca hoy.
     *
     * @param  array{actorType: string, actorId: ?string, actorName: string, ip?: ?string, requestId?: ?string}  $by
     */
    private function extend(SubscriptionPayment $payment, array $by): void
    {
        // Mismo orden de bloqueo que el panel de plataforma: comercio y después suscripción.
        $tenant = Tenant::whereKey($this->context->id())->lockForUpdate()->firstOrFail();
        $s = $this->current(lock: true) ?? throw AppError::notFound('Suscripción vigente');
        $now = Carbon::now();
        $due = self::dueAt($s);
        $start = $due !== null && $due->copy()->addDays(self::GRACE_DAYS)->gte($now) ? $due->copy() : $now;
        $end = $start->copy()->addMonthsNoOverflow($payment->months);
        $before = ['planCode' => Plan::find($s->plan_id)?->code, 'paidUntil' => Dates::iso($s->current_period_end)];
        $plan = Plan::findOrFail($payment->plan_id);

        $payment->forceFill(['period_from' => $start, 'period_to' => $end])->save();
        $s->forceFill(['plan_id' => $plan->id, 'status' => 'active', 'current_period_end' => $end, 'notice_due_at' => null, 'notice_stage' => null])->save();
        if (in_array($tenant->status, ['trial', 'past_due'], true)) {
            $tenant->forceFill(['status' => 'active'])->save();
        }
        $this->audit->record($by + [
            'tenantId' => $tenant->id,
            'action' => 'subscription.paid',
            'entityType' => 'subscription',
            'entityId' => $s->id,
            'before' => $before,
            'after' => [
                'planCode' => $plan->code, 'paidUntil' => Dates::iso($end), 'months' => $payment->months,
                'amount' => (string) $payment->amount, 'method' => $payment->method, 'paymentId' => $payment->id,
                'mpPaymentId' => $payment->mp_payment_id, 'notes' => $payment->notes,
            ],
        ]);
    }

    /** Reembolso o contracargo: se descuentan del vencimiento los meses de ese pago. */
    private function revert(SubscriptionPayment $payment, array $by): void
    {
        $s = $this->current(lock: true) ?? throw AppError::notFound('Suscripción vigente');
        $before = Dates::iso($s->current_period_end);
        $end = $s->current_period_end?->copy()->subMonthsNoOverflow($payment->months);
        $s->forceFill(['current_period_end' => $end, 'notice_due_at' => null, 'notice_stage' => null])->save();
        $this->audit->record($by + [
            'tenantId' => $this->context->id(),
            'action' => 'subscription.payment_refunded',
            'entityType' => 'subscription',
            'entityId' => $s->id,
            'before' => ['paidUntil' => $before],
            'after' => ['paidUntil' => Dates::iso($end), 'paymentId' => $payment->id, 'mpPaymentId' => $payment->mp_payment_id],
        ]);
    }

    private function current(bool $lock = false): ?Subscription
    {
        $query = Subscription::where('status', '<>', 'cancelled');

        return ($lock ? $query->lockForUpdate() : $query)->first();
    }

    private static function dueAt(Subscription $s): ?Carbon
    {
        $paid = $s->current_period_end;
        $trial = $s->trial_ends_at;
        if ($paid === null || $trial === null) {
            return ($paid ?? $trial)?->copy();
        }

        return ($paid->gt($trial) ? $paid : $trial)->copy();
    }

    /** Quienes pueden gestionar la suscripción y tienen email. @return iterable<User> */
    private function noticeRecipients(): iterable
    {
        $roles = RolePermission::where('permission_code', 'subscription.manage')->pluck('role_id');
        $users = Membership::where('status', 'active')->whereIn('role_id', $roles)->pluck('user_id');

        return User::whereIn('id', $users)->where('status', 'active')->whereNotNull('email')->get();
    }

    private static function planDto(Plan $p): array
    {
        return ['code' => $p->code, 'name' => $p->name, 'price' => (string) $p->price, 'currency' => $p->currency, 'limits' => (object) $p->limitMap()];
    }

    private static function monthsLabel(int $months): string
    {
        return $months === 1 ? '1 mes' : "{$months} meses";
    }

    private static function localDate(?Carbon $date): string
    {
        return $date ? $date->copy()->setTimezone('America/Argentina/Buenos_Aires')->format('d/m/Y') : '';
    }
}
