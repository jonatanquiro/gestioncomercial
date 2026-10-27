<?php

namespace App\Http\Controllers;

use App\Auth\Client;
use App\Auth\Cookies;
use App\Mail\OwnerInvitationMail;
use App\Models\AuditEntry;
use App\Models\Branch;
use App\Models\Membership;
use App\Models\PasswordResetToken;
use App\Models\Plan;
use App\Models\PlanFeature;
use App\Models\PlanLimit;
use App\Models\PlatformUser;
use App\Models\Product;
use App\Models\Register;
use App\Models\Subscription;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AuditService;
use App\Services\PasswordService;
use App\Services\PlatformSessionService;
use App\Services\ProvisioningService;
use App\Support\AppError;
use App\Support\Catalog;
use App\Support\Dates;
use App\Support\Input;
use App\Support\Throttle;
use App\Support\Tokens;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * Panel de plataforma (operadores del SaaS). Es el único lugar que consulta datos de varios
 * comercios a la vez, siempre dentro de TenantContext::withoutTenant.
 */
class PlatformController extends Controller
{
    /** Días para que el dueño invitado elija su contraseña. */
    private const INVITATION_DAYS = 7;

    public function __construct(
        private readonly PasswordService $passwords,
        private readonly PlatformSessionService $sessions,
        private readonly AuditService $audit,
        private readonly TenantContext $context,
        private readonly ProvisioningService $provisioning,
    ) {}

    /** Login con email y contraseña, con límite de intentos por IP. */
    public function login(Request $request): JsonResponse
    {
        $data = $this->body($request);
        $data['email'] = Input::email($data['email'] ?? null);
        $input = Input::validate($data, [
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => ['required', 'string', 'max:128'],
        ]);
        $client = Client::from($request);
        Throttle::consume("platform-login:{$client->ip}", 10, 15 * 60);

        $user = PlatformUser::where('email', $input['email'])->where('status', 'active')->first();
        $passwordOk = $this->passwords->verify($user?->password_hash, $input['password']);
        if (! $user || ! $passwordOk) {
            $this->audit->record([
                'tenantId' => null,
                'actorType' => 'platform',
                'actorId' => $user?->id,
                'actorName' => null,
                'action' => 'platform.login_failed',
                'entityType' => 'platform_user',
                'entityId' => $user?->id,
                'after' => ['email' => $input['email']],
                'ip' => $client->ip,
                'requestId' => $client->requestId,
            ]);
            throw AppError::invalidCredentials();
        }
        $token = DB::transaction(function () use ($user, $client) {
            $token = $this->sessions->create($user->id, $client);
            $this->audit->record([
                'tenantId' => null,
                'actorType' => 'platform',
                'actorId' => $user->id,
                'actorName' => $user->name,
                'action' => 'platform.login',
                'entityType' => 'platform_user',
                'entityId' => $user->id,
                'ip' => $client->ip,
                'requestId' => $client->requestId,
            ]);

            return $token;
        });

        return $this->json(['ok' => true])
            ->withCookie(Cookies::session(Cookies::PLATFORM_SESSION, $token, Cookies::PLATFORM_MAX_SECONDS))
            ->withCookie(Cookies::csrf(Tokens::random()));
    }

    public function logout(Request $request): JsonResponse
    {
        $this->sessions->revoke($this->platformActor($request)->sessionId);

        return $this->json(['ok' => true])->withCookie(Cookies::forget(Cookies::PLATFORM_SESSION));
    }

    public function me(Request $request): JsonResponse
    {
        $actor = $this->platformActor($request);
        [$csrf, $cookie] = Cookies::ensureCsrf($request);
        $response = $this->json(['id' => $actor->platformUserId, 'name' => $actor->name, 'csrfToken' => $csrf]);

        return $cookie ? $response->withCookie($cookie) : $response;
    }

    public function tenants(Request $request): JsonResponse
    {
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $q = Input::validate($request->query(), [
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'string', 'in:trial,active,past_due,suspended,cancelled'],
        ]);

        return $this->json($this->context->withoutTenant(function () use ($q, $page, $pageSize) {
            $query = Tenant::query()
                ->when($q['q'] ?? null, function ($w, $term) {
                    $like = '%'.addcslashes($term, '%_\\').'%';
                    $w->where(fn ($o) => $o->where('trade_name', 'like', $like)->orWhere('cuit', 'like', $like));
                })
                ->when($q['status'] ?? null, fn ($w, $status) => $w->where('status', $status));
            $total = (clone $query)->count();
            $rows = $query->orderByDesc('created_at')->orderByDesc('id')->forPage($page, $pageSize)->get();
            $ids = $rows->pluck('id')->all();

            $subs = Subscription::whereIn('tenant_id', $ids)->where('status', '<>', 'cancelled')->get()->keyBy('tenant_id');
            $planCodes = Plan::whereIn('id', $subs->pluck('plan_id')->unique()->all())->pluck('code', 'id');
            $users = Membership::whereIn('tenant_id', $ids)->where('status', 'active')
                ->groupBy('tenant_id')->selectRaw('tenant_id, count(*) as n')->pluck('n', 'tenant_id');
            $branches = Branch::whereIn('tenant_id', $ids)->where('status', 'active')
                ->groupBy('tenant_id')->selectRaw('tenant_id, count(*) as n')->pluck('n', 'tenant_id');

            return [
                'items' => $rows->map(function (Tenant $t) use ($subs, $planCodes, $users, $branches) {
                    $sub = $subs->get($t->id);

                    return [
                        'id' => $t->id,
                        'tradeName' => $t->trade_name,
                        'cuit' => $t->cuit,
                        'businessTypeCode' => $t->business_type_code,
                        'status' => $t->status,
                        'planCode' => $sub ? ($planCodes[$sub->plan_id] ?? null) : null,
                        'subscriptionStatus' => $sub?->status,
                        'trialEndsAt' => Dates::iso($sub?->trial_ends_at),
                        'createdAt' => Dates::iso($t->created_at),
                        'userCount' => (int) ($users[$t->id] ?? 0),
                        'branchCount' => (int) ($branches[$t->id] ?? 0),
                    ];
                })->all(),
                'total' => $total,
                'page' => $page,
                'pageSize' => $pageSize,
            ];
        }));
    }

    /**
     * Alta manual de un comercio (mismas reglas que platformCreateTenantSchema). Si el email del
     * dueño no tiene cuenta, se usa la contraseña indicada o se lo invita por correo.
     * Si ya tiene cuenta, el comercio se suma a los suyos sin cambiar su contraseña.
     */
    public function createTenant(Request $request): JsonResponse
    {
        $actor = $this->platformActor($request);
        $data = $this->body($request);
        $data['ownerEmail'] = Input::email($data['ownerEmail'] ?? null);
        $input = Input::validate($data, [
            'tradeName' => ['required', 'string', 'max:120'],
            'legalName' => ['nullable', 'string', 'max:160'],
            'cuit' => ['nullable', 'string', Input::cuitRule()],
            'taxCondition' => ['required', 'string', Rule::in(Catalog::taxConditions())],
            'businessTypeCode' => ['required', 'string', 'max:40'],
            'planCode' => ['required', 'string', 'max:40', Rule::exists('plans', 'code')->where('active', true)],
            'ownerName' => ['required', 'string', 'max:120'],
            'ownerEmail' => ['required', 'string', 'email', 'max:254'],
            'ownerPassword' => ['nullable', 'string', 'min:10', 'max:128'],
        ], ['planCode.exists' => 'Plan inexistente o inactivo', ...Input::passwordMessages('ownerPassword')]);
        $password = $input['ownerPassword'] ?? null;
        unset($input['ownerPassword']);
        $input['legalName'] = $input['legalName'] ?? null;
        $input['cuit'] = Input::optionalCuit($input['cuit'] ?? null);
        $client = Client::from($request);
        $token = Tokens::random();

        [$tenantId, $owner, $invited] = DB::transaction(function () use ($actor, $input, $client, $token, $password) {
            $owner = User::where('email', $input['ownerEmail'])->lockForUpdate()->first();
            if ($owner && $owner->status !== 'active') {
                throw AppError::conflict('USER_INACTIVE', 'Ese email pertenece a un usuario desactivado');
            }
            if ($owner && $password !== null) {
                throw AppError::validation([['path' => 'ownerPassword', 'message' => 'Ese email ya tiene cuenta. Dejá la contraseña vacía para conservar su acceso actual.']]);
            }
            $invited = $owner === null && $password === null;
            try {
                $hash = $owner ? null : $this->passwords->hash($password ?? Tokens::random());
            } catch (AppError $e) {
                if ($e->errorCode !== 'VALIDATION_ERROR') {
                    throw $e;
                }
                throw AppError::validation([['path' => 'ownerPassword', 'message' => $e->details[0]['message']]]);
            }
            $owner ??= User::create([
                'email' => $input['ownerEmail'],
                'name' => $input['ownerName'],
                'password_hash' => $hash,
                'password_changed_at' => Carbon::now(),
            ]);
            $tenantId = $this->provisioning->create($owner->id, $owner->name, $input, $client, [
                'actorType' => 'platform',
                'actorId' => $actor->platformUserId,
                'actorName' => "Plataforma: {$actor->name}",
            ]);
            if ($invited) {
                PasswordResetToken::create([
                    'user_id' => $owner->id,
                    'token_hash' => Tokens::hash($token),
                    'expires_at' => Carbon::now()->addDays(self::INVITATION_DAYS),
                ]);
            }

            return [$tenantId, $owner, $invited];
        });

        // El comercio ya quedó creado: si el correo falla, se avisa y el dueño puede usar "¿Olvidaste tu contraseña?".
        $sent = false;
        if ($invited) {
            $link = rtrim((string) config('app.url'), '/').'/restablecer?token='.rawurlencode($token);
            try {
                Mail::to($owner->email)->send(new OwnerInvitationMail($owner->name, $input['tradeName'], $link, self::INVITATION_DAYS));
                $sent = true;
            } catch (Throwable $e) {
                Log::error("No se pudo enviar la invitación del comercio {$tenantId}: ".$e->getMessage());
            }
        }

        return $this->json(['id' => $tenantId, 'ownerInvited' => $invited, 'invitationSent' => $sent, 'ownerPasswordSet' => $password !== null], 201);
    }

    public function setTenantStatus(Request $request, string $id): JsonResponse
    {
        $actor = $this->platformActor($request);
        $input = Input::validate($this->body($request), [
            'status' => ['required', 'string', 'in:active,suspended'],
            'reason' => ['required', 'string', 'max:300'],
        ]);
        DB::transaction(function () use ($actor, $id, $input) {
            $tenant = Tenant::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Comercio');
            if ($tenant->status === 'cancelled') {
                throw AppError::conflict('TENANT_CANCELLED', 'El comercio está dado de baja');
            }
            $before = $tenant->status;
            $tenant->forceFill(['status' => $input['status']])->save();
            $this->audit->record([
                'tenantId' => $id,
                'actorType' => 'platform',
                'actorId' => $actor->platformUserId,
                'actorName' => "Plataforma: {$actor->name}",
                'action' => $input['status'] === 'suspended' ? 'platform.tenant_suspended' : 'platform.tenant_activated',
                'entityType' => 'tenant',
                'entityId' => $id,
                'before' => ['status' => $before],
                'after' => ['status' => $input['status'], 'reason' => $input['reason']],
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);
        });

        return $this->json(['ok' => true]);
    }

    public function plans(): JsonResponse
    {
        return $this->json(Plan::with(['limits', 'features'])->orderBy('sort_order')->get()->map(fn (Plan $p) => $this->planDto($p))->all());
    }

    public function changeTenantPlan(Request $request, string $id): JsonResponse
    {
        $actor = $this->platformActor($request);
        $v = Input::validate($this->body($request), ['planCode' => ['required', 'string', 'max:40'], 'expectedPlanCode' => ['present', 'nullable', 'string', 'max:40'], 'reason' => ['required', 'string', 'max:300']]);
        $this->context->withoutTenant(fn () => DB::transaction(function () use ($actor, $v, $id) {
            $tenant = Tenant::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Comercio');
            if ($tenant->status === 'cancelled') {
                throw AppError::conflict('TENANT_CANCELLED', 'El comercio está dado de baja');
            }
            $subscription = Subscription::where('tenant_id', $id)->where('status', '<>', 'cancelled')->lockForUpdate()->first() ?? throw AppError::notFound('Suscripción vigente');
            $previous = Plan::find($subscription->plan_id);
            if ($previous?->code !== ($v['expectedPlanCode'] ?? null)) {
                throw AppError::conflict('PLAN_CHANGED', 'Otra persona cambió el plan. Actualizá la lista y volvé a intentarlo.');
            }
            $plan = Plan::where('code', $v['planCode'])->where('active', true)->lockForUpdate()->first() ?? throw AppError::notFound('Plan activo');
            if ($plan->id === $subscription->plan_id) {
                throw AppError::badRequest('PLAN_UNCHANGED', 'Elegí un plan diferente');
            }
            $usage = ['max_branches' => Branch::where('tenant_id', $id)->where('status', 'active')->count(), 'max_users' => Membership::where('tenant_id', $id)->where('status', 'active')->count(), 'max_products' => Product::where('tenant_id', $id)->where('status', 'active')->count(), 'max_registers' => Register::where('tenant_id', $id)->where('status', 'active')->count()];
            $limits = $plan->limitMap();
            $labels = ['max_branches' => 'sucursales', 'max_users' => 'usuarios', 'max_products' => 'productos', 'max_registers' => 'cajas'];
            foreach ($usage as $key => $used) {
                if (isset($limits[$key]) && $used > $limits[$key]) {
                    throw AppError::conflict('PLAN_USAGE_EXCEEDED', "El comercio tiene {$used} {$labels[$key]} activos y el plan permite {$limits[$key]}. Reducí el uso antes de cambiarlo.");
                }
            }
            $subscription->forceFill(['plan_id' => $plan->id])->save();
            $this->audit->record(['tenantId' => $id, 'actorType' => 'platform', 'actorId' => $actor->platformUserId, 'actorName' => 'Plataforma: '.$actor->name, 'action' => 'platform.tenant_plan_changed', 'entityType' => 'tenant', 'entityId' => $id, 'before' => ['planCode' => $previous?->code], 'after' => ['planCode' => $plan->code, 'reason' => $v['reason'], 'usage' => $usage], 'ip' => $actor->ip, 'requestId' => $actor->requestId]);
        }));

        return $this->json(['ok' => true]);
    }

    public function updatePlan(Request $request, string $id): JsonResponse
    {
        $actor = $this->platformActor($request);
        $limitKeys = Catalog::planLimitKeys();
        $input = Input::validate($this->body($request), [
            'name' => ['required', 'string', 'max:60'],
            'price' => ['required', 'string', 'regex:/^\d{1,10}(\.\d{1,2})?$/'],
            'trialDays' => ['present', 'integer', 'min:0', 'max:365'],
            'active' => ['present', Input::strictBoolean()],
            'limits' => ['present', 'array'],
            'limits.*' => ['integer', 'min:0', 'max:100000'],
            'features' => ['present', 'array', 'list', 'max:20'],
            'features.*' => ['string', Rule::in(Catalog::planFeatures())],
        ], ['price.regex' => 'Importe inválido']);
        $unknown = array_diff(array_keys($input['limits']), $limitKeys);
        if ($unknown !== []) {
            throw AppError::validation(array_map(fn ($k) => ['path' => "limits.{$k}", 'message' => 'Límite inexistente'], array_values($unknown)));
        }

        return $this->json(DB::transaction(function () use ($actor, $id, $input) {
            $plan = Plan::whereKey($id)->lockForUpdate()->first() ?? throw AppError::notFound('Plan');
            $before = $this->planDto($plan->load(['limits', 'features']));
            $plan->fill(['name' => $input['name'], 'price' => $input['price'], 'trial_days' => $input['trialDays'], 'active' => $input['active']])->save();
            PlanLimit::where('plan_id', $id)->delete();
            PlanLimit::insert(array_map(fn ($k, $v) => ['plan_id' => $id, 'key' => $k, 'value' => (int) $v], array_keys($input['limits']), $input['limits']));
            PlanFeature::where('plan_id', $id)->delete();
            PlanFeature::insert(array_map(fn ($f) => ['plan_id' => $id, 'feature' => $f], array_values(array_unique($input['features']))));
            $after = $this->planDto($plan->refresh()->load(['limits', 'features']));
            $this->audit->record([
                'tenantId' => null,
                'actorType' => 'platform',
                'actorId' => $actor->platformUserId,
                'actorName' => $actor->name,
                'action' => 'platform.plan_updated',
                'entityType' => 'plan',
                'entityId' => $id,
                'before' => $before,
                'after' => $after,
                'ip' => $actor->ip,
                'requestId' => $actor->requestId,
            ]);

            return $after;
        }));
    }

    /** Auditoría propia de la plataforma: acciones de operadores y eventos sin comercio. */
    public function audit(Request $request): JsonResponse
    {
        ['page' => $page, 'pageSize' => $pageSize] = $this->pagination($request);
        $query = AuditEntry::where(fn ($w) => $w->where('actor_type', 'platform')->orWhereNull('tenant_id'));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('at')->orderByDesc('id')->forPage($page, $pageSize)->get();

        return $this->json([
            'items' => $rows->map(fn (AuditEntry $r) => [
                'id' => $r->id,
                'tenantId' => $r->tenant_id,
                'actorType' => $r->actor_type,
                'actorId' => $r->actor_id,
                'actorName' => $r->actor_name,
                'action' => $r->action,
                'entityType' => $r->entity_type,
                'entityId' => $r->entity_id,
                'before' => $r->before,
                'after' => $r->after,
                'ip' => $r->ip,
                'requestId' => $r->request_id,
                'at' => Dates::iso($r->at),
            ])->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
        ]);
    }

    /** Forma de PlanDto. */
    private function planDto(Plan $p): array
    {
        return [
            'id' => $p->id,
            'code' => $p->code,
            'name' => $p->name,
            'price' => (string) $p->price,
            'currency' => $p->currency,
            'trialDays' => $p->trial_days,
            'active' => $p->active,
            'limits' => (object) $p->limitMap(),
            'features' => $p->featureList(),
        ];
    }
}
