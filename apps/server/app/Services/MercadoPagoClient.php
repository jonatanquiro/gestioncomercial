<?php

namespace App\Services;

use App\Support\AppError;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/** API de Mercado Pago (Checkout Pro). La credencial sale de MP_ACCESS_TOKEN y nunca llega al navegador. */
class MercadoPagoClient
{
    public function configured(): bool
    {
        return $this->token() !== '';
    }

    /**
     * Crea la preferencia de pago y devuelve su id y la dirección a la que hay que mandar a la persona.
     *
     * @param  array<string, mixed>  $preference
     * @return array{id: string, url: string}
     */
    public function createPreference(array $preference, string $idempotencyKey): array
    {
        $res = $this->send('post', '/checkout/preferences', $preference, ['X-Idempotency-Key' => $idempotencyKey]);
        if (! $res->successful() || ! is_string($res->json('init_point'))) {
            throw new AppError(502, 'MP_PREFERENCE_FAILED', 'No pudimos iniciar el pago con Mercado Pago. Probá de nuevo en un momento.', ['status' => $res->status()]);
        }

        return ['id' => (string) $res->json('id'), 'url' => $res->json('init_point')];
    }

    /** @return array<string, mixed>|null el pago, o null si Mercado Pago no lo conoce */
    public function payment(string $id): ?array
    {
        $res = $this->send('get', '/v1/payments/'.rawurlencode($id));
        if ($res->status() === 404) {
            return null;
        }
        if (! $res->successful()) {
            throw new AppError(502, 'MP_UNAVAILABLE', 'Mercado Pago no respondió. Probá de nuevo en un momento.', ['status' => $res->status()]);
        }

        return $res->json();
    }

    /** @return list<array<string, mixed>> pagos con esa referencia externa, el más nuevo primero */
    public function searchByReference(string $reference): array
    {
        $res = $this->send('get', '/v1/payments/search?'.http_build_query([
            'sort' => 'date_created', 'criteria' => 'desc', 'limit' => 10, 'external_reference' => $reference,
        ]));
        if (! $res->successful()) {
            throw new AppError(502, 'MP_UNAVAILABLE', 'Mercado Pago no respondió. Probá de nuevo en un momento.', ['status' => $res->status()]);
        }
        $results = $res->json('results');

        return is_array($results) ? array_values($results) : [];
    }

    /**
     * Firma de los avisos: "ts=...,v1=..." con HMAC-SHA256 sobre "id:<id>;request-id:<pedido>;ts:<ts>;".
     * Sin clave configurada no hay nada que verificar.
     */
    public function validSignature(?string $signature, ?string $requestId, string $dataId): bool
    {
        $secret = (string) config('services.mercadopago.webhook_secret');
        if ($secret === '' || $signature === null || $signature === '') {
            return true;
        }
        $parts = [];
        foreach (explode(',', $signature) as $part) {
            [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
            $parts[$k] = $v;
        }
        $manifest = 'id:'.strtolower($dataId).';request-id:'.($requestId ?? '').';ts:'.($parts['ts'] ?? '').';';

        return hash_equals(hash_hmac('sha256', $manifest, $secret), $parts['v1'] ?? '');
    }

    /** @param  array<string, mixed>|null  $body */
    private function send(string $method, string $path, ?array $body = null, array $headers = []): Response
    {
        if (! $this->configured()) {
            throw AppError::conflict('MP_NOT_CONFIGURED', 'El cobro con Mercado Pago no está configurado');
        }
        $request = Http::baseUrl('https://api.mercadopago.com')->withToken($this->token())->withHeaders($headers)->acceptJson()->timeout(20);
        try {
            return $body === null ? $request->{$method}($path) : $request->{$method}($path, $body);
        } catch (ConnectionException) {
            throw new AppError(502, 'MP_UNAVAILABLE', 'Mercado Pago no respondió. Probá de nuevo en un momento.');
        }
    }

    private function token(): string
    {
        return trim((string) config('services.mercadopago.access_token'));
    }
}
