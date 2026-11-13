<?php

namespace App\Http\Controllers;

use App\Models\Plan;
use App\Services\BillingService;
use App\Services\MercadoPagoClient;
use App\Support\AppError;
use App\Support\Input;
use App\Support\Throttle;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/** Plan y suscripción del comercio, y aviso automático de Mercado Pago (ADR 0012). */
class SubscriptionController extends Controller
{
    public function __construct(
        private readonly BillingService $billing,
        private readonly MercadoPagoClient $mp,
    ) {}

    public function show(): JsonResponse
    {
        return $this->json($this->billing->overview());
    }

    /** Mismas reglas que subscriptionCheckoutSchema. */
    public function checkout(Request $request): JsonResponse
    {
        $input = Input::validate($this->body($request), [
            'planCode' => ['required', 'string', 'max:40'],
            'months' => ['required', Input::oneOfIntegers(BillingService::MONTH_OPTIONS)],
        ]);

        return $this->json($this->billing->startCheckout($this->actor($request), $input['planCode'], $input['months']), 201);
    }

    /** Vuelta desde Mercado Pago: el número de pago es solo una pista, el estado se consulta a Mercado Pago. */
    public function check(Request $request, string $id): JsonResponse
    {
        $input = Input::validate($this->body($request), ['mpPaymentId' => ['nullable', 'string', 'max:40']]);
        $payment = $this->billing->check($id, $input['mpPaymentId'] ?? null);

        return $this->json(BillingService::paymentDto($payment, Plan::find($payment->plan_id)?->name));
    }

    /**
     * Aviso automático de Mercado Pago. Del aviso solo se toma el número de pago. Si algo falla,
     * la respuesta no es 2xx y Mercado Pago lo reintenta más tarde.
     */
    public function webhook(Request $request): JsonResponse
    {
        Throttle::consume('mp-webhook:'.$request->ip(), 120, 60);
        $body = $this->body($request);
        $type = (string) ($request->query('type') ?? $request->query('topic') ?? $body['type'] ?? $body['topic'] ?? '');
        $data = is_array($body['data'] ?? null) ? $body['data'] : [];
        $id = (string) ($request->query('data_id') ?? $request->query('id') ?? $data['id'] ?? '');
        if (! $this->mp->validSignature($request->header('x-signature'), $request->header('x-request-id'), $id)) {
            throw new AppError(401, 'MP_SIGNATURE_INVALID', 'Firma del aviso inválida');
        }
        if ($type === 'payment' && $id !== '') {
            try {
                $this->billing->processMpPayment($id);
            } catch (AppError $e) {
                Log::warning("Aviso de Mercado Pago del pago {$id}: {$e->getMessage()}");
                throw $e;
            }
        }

        return $this->json(['ok' => true]);
    }
}
