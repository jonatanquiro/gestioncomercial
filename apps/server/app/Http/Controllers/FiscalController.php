<?php

namespace App\Http\Controllers;

use App\Auth\Actor;
use App\Models\FiscalInvoice;
use App\Models\FiscalSetting;
use App\Models\Sale;
use App\Services\ArcaClient;
use App\Services\AuditService;
use App\Services\FiscalIssuer;
use App\Support\AppError;
use App\Support\Cuit;
use App\Support\Input;
use App\Support\OpenSslConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class FiscalController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function settings(): JsonResponse
    {
        return $this->json(FiscalSetting::all()->map(fn ($s) => $this->settingDto($s))->all());
    }

    public function save(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), [
            'environment' => ['required', 'in:homologacion,produccion'], 'cuit' => ['required', 'string', Input::cuitRule()],
            'pointOfSale' => ['required', 'integer', 'min:1', 'max:99999'], 'credentialMode' => ['required', 'in:own,delegated'],
            'certificatePem' => ['nullable', 'string', 'max:20000'], 'privateKeyPem' => ['nullable', 'string', 'max:20000'],
            'grossIncomeNumber' => ['nullable', 'string', 'max:60'], 'activityStartDate' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'],
        ]);
        $result = Cache::lock('arca-issuer-'.$actor->tenantId.'-'.$v['environment'], 300)->block(5, fn () => DB::transaction(function () use ($actor, $v) {
            $s = FiscalSetting::where('environment', $v['environment'])->lockForUpdate()->first();
            if (FiscalInvoice::where('environment', $v['environment'])->where('status', 'pending')->exists()) {
                throw AppError::conflict('FISCAL_PENDING', 'Primero resolvé el comprobante pendiente antes de cambiar las credenciales');
            }
            $certificate = $v['certificatePem'] ?? ($s?->certificate_enc ? Crypt::decryptString($s->certificate_enc) : null);
            $key = $v['privateKeyPem'] ?? ($s?->private_key_enc ? Crypt::decryptString($s->private_key_enc) : null);
            $cuit = Cuit::normalize($v['cuit']);
            if ($key && ! @openssl_pkey_get_private($key)) {
                throw AppError::validation([['path' => 'privateKeyPem', 'message' => 'La clave privada es inválida o está protegida con contraseña']]);
            }
            if ($certificate) {
                $parsed = @openssl_x509_parse($certificate);
                if (! $parsed || ($parsed['validTo_time_t'] ?? 0) <= time() || ($parsed['validFrom_time_t'] ?? PHP_INT_MAX) > time()) {
                    throw AppError::validation([['path' => 'certificatePem', 'message' => 'Certificado inválido, vencido o todavía no vigente']]);
                }
                if (! $key || ! @openssl_x509_check_private_key($certificate, $key)) {
                    throw AppError::validation([['path' => 'certificatePem', 'message' => 'El certificado no corresponde a la clave privada']]);
                }
                $certificateCuit = preg_replace('/\D/', '', $parsed['subject']['serialNumber'] ?? '');
                if ($v['credentialMode'] === 'own' && $certificateCuit !== $cuit) {
                    throw AppError::validation([['path' => 'cuit', 'message' => 'El CUIT no coincide con el certificado propio. Si es una delegación, elegí certificado delegado.']]);
                }
            }
            // ARCA da un solo ticket vigente por certificado: se conserva si no cambian el certificado, la clave ni el CUIT.
            $sameCredentials = $s && $s->cuit === $cuit && $certificate !== null && $s->certificate_enc && Crypt::decryptString($s->certificate_enc) === $certificate
                && $s->private_key_enc && Crypt::decryptString($s->private_key_enc) === $key;
            $ticket = $sameCredentials ? ['ticket_enc' => $s->ticket_enc, 'ticket_expires_at' => $s->ticket_expires_at] : ['ticket_enc' => null, 'ticket_expires_at' => null];
            $s ??= new FiscalSetting;
            $s->forceFill(['environment' => $v['environment'], 'cuit' => $cuit, 'point_of_sale' => $v['pointOfSale'], 'credential_mode' => $v['credentialMode'], 'issuer_metadata' => ['grossIncomeNumber' => $v['grossIncomeNumber'] ?? null, 'activityStartDate' => $v['activityStartDate'] ?? null], 'certificate_enc' => $certificate ? Crypt::encryptString($certificate) : null, 'private_key_enc' => $key ? Crypt::encryptString($key) : null, ...$ticket])->save();
            $this->record($actor, 'fiscal.settings_updated', $s->id, ['environment' => $s->environment, 'cuit' => $cuit, 'pointOfSale' => $s->point_of_sale, 'certificateLoaded' => (bool) $certificate]);

            return $this->settingDto($s);
        }));

        return $this->json($result);
    }

    public function csr(Request $request): JsonResponse
    {
        $actor = $this->actor($request);
        $v = Input::validate($this->body($request), ['environment' => ['required', 'in:homologacion,produccion'], 'cuit' => ['required', 'string', Input::cuitRule()], 'alias' => ['required', 'string', 'max:60', 'regex:/^[a-zA-Z0-9_-]+$/'], 'organization' => ['required', 'string', 'max:100']]);
        $result = Cache::lock('arca-issuer-'.$actor->tenantId.'-'.$v['environment'], 300)->block(5, fn () => DB::transaction(function () use ($v, $actor) {
            $s = FiscalSetting::where('environment', $v['environment'])->lockForUpdate()->first();
            $cuit = Cuit::normalize($v['cuit']);
            if ($s && $s->cuit !== $cuit) {
                throw AppError::badRequest('FISCAL_CUIT', 'Guardá primero la configuración con el CUIT que querés usar');
            }
            $conf = OpenSslConfig::options();
            $pem = $s?->private_key_enc ? Crypt::decryptString($s->private_key_enc) : null;
            $key = $pem ? openssl_pkey_get_private($pem) : openssl_pkey_new($conf + ['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            if (! $key || (! $pem && ! openssl_pkey_export($key, $pem, null, $conf))) {
                throw AppError::badRequest('FISCAL_KEY', 'No se pudo generar la clave; revisá OpenSSL y OPENSSL_CONF');
            }
            $csr = openssl_csr_new(['countryName' => 'AR', 'organizationName' => $v['organization'], 'commonName' => $v['alias'], 'serialNumber' => 'CUIT '.$cuit], $key, $conf + ['digest_alg' => 'sha256']);
            if (! $csr || ! openssl_csr_export($csr, $text)) {
                throw AppError::badRequest('FISCAL_CSR', 'No se pudo generar el pedido de certificado');
            }
            $s ??= new FiscalSetting;
            $s->forceFill(['environment' => $v['environment'], 'cuit' => $cuit, 'private_key_enc' => Crypt::encryptString($pem), 'csr' => $text])->save();
            $this->record($actor, 'fiscal.csr_created', $s->id, ['environment' => $s->environment]);

            return ['csr' => $text];
        }));

        return $this->json($result);
    }

    public function check(Request $request): JsonResponse
    {
        $v = Input::validate($this->body($request), ['environment' => ['required', 'in:homologacion,produccion']]);
        $s = FiscalSetting::where('environment', $v['environment'])->first() ?? throw AppError::notFound('Configuración fiscal');
        $result = app(ArcaClient::class)->check($s);
        $this->record($this->actor($request), 'fiscal.connection_checked', $s->id, ['environment' => $s->environment]);

        return $this->json($result);
    }

    public function invoices(Request $request): JsonResponse
    {
        $v = Input::validate($request->query(), ['saleId' => ['nullable', 'uuid']]);

        return $this->json(FiscalInvoice::when($v['saleId'] ?? null, fn ($q, $id) => $q->where('sale_id', $id))->orderByDesc('created_at')->limit(100)->get()->map(fn ($i) => $this->invoiceDto($i))->all());
    }

    public function issue(Request $request, string $id): JsonResponse
    {
        Sale::find($id) ?? throw AppError::notFound('Venta');
        $v = Input::validate($this->body($request), [
            'environment' => ['required', 'in:homologacion,produccion'], 'voucherType' => ['required', 'integer', Rule::in([1, 6, 11])],
            'documentType' => ['required', 'integer', Rule::in([80, 96, 99])], 'documentNumber' => ['required', 'string', 'regex:/^\d{1,11}$/'],
            'buyerName' => ['required', 'string', 'max:160'], 'buyerAddress' => ['nullable', 'string', 'max:200'],
            'vatCondition' => ['required', 'integer', 'min:1', 'max:99'], 'confirmProduction' => ['nullable', Input::strictBoolean()],
        ]);
        if ($v['environment'] === 'produccion' && ($v['confirmProduction'] ?? false) !== true) {
            throw AppError::badRequest('FISCAL_CONFIRMATION', 'Confirmá que querés emitir un comprobante fiscal real');
        }
        $v['documentType'] = (int) $v['documentType'];
        $v['voucherType'] = (int) $v['voucherType'];
        $v['vatCondition'] = (int) $v['vatCondition'];
        $v['documentNumber'] = (string) (int) $v['documentNumber'];
        if ($v['documentType'] === 96 && (! preg_match('/^\d{6,9}$/', $v['documentNumber']) || (int) $v['documentNumber'] === 0)) {
            throw AppError::validation([['path' => 'documentNumber', 'message' => 'Ingresá un DNI válido, sin puntos']]);
        }
        if (($v['documentType'] === 80 && ! Cuit::isValid($v['documentNumber'])) || ($v['documentType'] === 99 && ($v['documentNumber'] !== '0' || $v['vatCondition'] !== 5))) {
            throw AppError::validation([['path' => 'documentNumber', 'message' => 'Revisá el documento: CUIT válido o consumidor final sin identificar con número 0']]);
        }
        $invoice = app(FiscalIssuer::class)->issue($this->actor($request), $id, $v);

        return $this->json($this->invoiceDto($invoice));
    }

    private function settingDto(FiscalSetting $s): array
    {
        $certificate = $s->certificate_enc ? @openssl_x509_parse(Crypt::decryptString($s->certificate_enc)) : null;

        return ['environment' => $s->environment, 'cuit' => $s->cuit, 'pointOfSale' => $s->point_of_sale, 'credentialMode' => $s->credential_mode, 'grossIncomeNumber' => $s->issuer_metadata['grossIncomeNumber'] ?? null, 'activityStartDate' => $s->issuer_metadata['activityStartDate'] ?? null, 'hasCertificate' => (bool) $s->certificate_enc, 'hasPrivateKey' => (bool) $s->private_key_enc, 'certificateExpiresOn' => isset($certificate['validTo_time_t']) ? gmdate('Y-m-d', $certificate['validTo_time_t']) : null, 'csr' => $s->csr];
    }

    private function invoiceDto(FiscalInvoice $i): array
    {
        return ['id' => $i->id, 'saleId' => $i->sale_id, 'environment' => $i->environment, 'cuit' => $i->cuit, 'pointOfSale' => $i->point_of_sale, 'voucherType' => $i->voucher_type, 'number' => $i->number, 'status' => $i->status, 'cae' => $i->cae, 'caeExpiresOn' => $i->cae_expires_on, 'message' => $i->message, 'payload' => $i->payload];
    }

    private function record(Actor $actor, string $action, string $id, array $after): void
    {
        $this->audit->record(['tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName, 'action' => $action, 'entityType' => 'fiscal_setting', 'entityId' => $id, 'after' => $after, 'ip' => $actor->ip, 'requestId' => $actor->requestId]);
    }
}
