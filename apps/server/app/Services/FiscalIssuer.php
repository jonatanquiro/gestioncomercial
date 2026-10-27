<?php

namespace App\Services;

use App\Auth\Actor;
use App\Models\FiscalInvoice;
use App\Models\FiscalSetting;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Models\SaleLine;
use App\Models\SaleReturn;
use App\Models\Tenant;
use App\Support\AppError;
use App\Support\Money;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class FiscalIssuer
{
    public function __construct(private readonly ArcaClient $arca, private readonly AuditService $audit, private readonly EntitlementsService $entitlements) {}

    public function issue(Actor $actor, string $saleId, array $input): FiscalInvoice
    {
        $setting = FiscalSetting::where('environment', $input['environment'])->first() ?? throw AppError::notFound('Configuración fiscal');

        return Cache::lock('arca-issuer-'.$setting->tenant_id.'-'.$setting->environment, 300)->block(5, function () use ($actor, $setting, $saleId, $input) {
            $sale = Sale::find($saleId) ?? throw AppError::notFound('Venta');
            $existing = FiscalInvoice::where('sale_id', $saleId)->where('environment', $setting->environment)->first();
            if ($existing?->status === 'authorized') {
                return $existing;
            }
            $rejected = $existing?->status === 'rejected' ? $existing : null;
            if ($rejected) {
                $existing = null;
            }
            if (! $existing && ! in_array('fiscal_arca', $this->entitlements->plan()['features'] ?? [], true)) {
                throw AppError::badRequest('FISCAL_PLAN', 'El plan actual no incluye nuevas emisiones ARCA. Los comprobantes anteriores se conservan y los pendientes pueden consultarse.');
            }
            if ($sale->status !== 'confirmed' || SaleReturn::where('sale_id', $saleId)->exists()) {
                throw AppError::badRequest('FISCAL_SALE', 'Solo se puede facturar una venta confirmada sin devoluciones');
            }
            $tenant = Tenant::find($actor->tenantId);
            if ($setting->environment === 'produccion' && (! $tenant->cuit || ! $tenant->legal_name || ! $tenant->address || empty($setting->issuer_metadata['grossIncomeNumber']) || empty($setting->issuer_metadata['activityStartDate']))) {
                throw AppError::badRequest('FISCAL_ISSUER_DATA', 'Completá CUIT, razón social y domicilio del comercio, e Ingresos Brutos y fecha de inicio de actividades, antes de emitir en producción');
            }
            if ($tenant->cuit && $tenant->cuit !== $setting->cuit) {
                throw AppError::badRequest('FISCAL_CUIT', 'El CUIT del emisor configurado debe coincidir con el del comercio');
            }
            $lines = SaleLine::where('sale_id', $saleId)->get();
            $productIds = ProductVariant::whereIn('id', $lines->pluck('variant_id'))->pluck('product_id');
            if (Product::whereIn('id', $productIds)->where('kind', 'service')->exists()) {
                throw AppError::badRequest('FISCAL_SERVICES', 'Esta primera integración factura bienes en ARS. Los servicios requieren concepto y fechas de prestación.');
            }
            $type = (int) $input['voucherType'];
            if (! $existing) {
                if (FiscalInvoice::where('environment', $setting->environment)->where('status', 'pending')->exists()) {
                    throw AppError::conflict('FISCAL_PENDING', 'Hay un comprobante con respuesta pendiente. Consultalo o reintentá esa misma venta antes de emitir otra.');
                }
                $payload = app(FiscalPayload::class)->build($tenant->tax_condition, $type, $input, $lines->map(fn ($line) => ['vatRate' => $line->vat_rate, 'total' => $line->line_total])->all(), $sale->total);
                $last = $this->arca->call($setting, 'FECompUltimoAutorizado', '<PtoVta>'.$setting->point_of_sale.'</PtoVta><CbteTipo>'.$type.'</CbteTipo>');
                ArcaClient::assertNoErrors($last);
                $lastNumber = ArcaClient::value($last, 'CbteNro');
                if (! preg_match('/^\d+$/', $lastNumber)) {
                    throw AppError::badRequest('ARCA_NUMBER', 'ARCA no confirmó el último número autorizado');
                }
                $number = (int) $lastNumber + 1;
                // La intención y el número se guardan ANTES de solicitar autorización: un timeout nunca genera otro número.
                $values = ['sale_id' => $saleId, 'environment' => $setting->environment, 'cuit' => $setting->cuit, 'point_of_sale' => $setting->point_of_sale, 'voucher_type' => $type, 'number' => $number, 'status' => 'pending', 'message' => null, 'payload' => ['request' => $payload, 'buyerName' => $input['buyerName'], 'issuerName' => $tenant->legal_name ?: $tenant->trade_name, 'issuerAddress' => $tenant->address, 'issuerTaxCondition' => $tenant->tax_condition, 'issuerMetadata' => $setting->issuer_metadata, 'buyerAddress' => $input['buyerAddress'] ?? null], 'created_by' => $actor->userId];
                $existing = DB::transaction(function () use ($rejected, $values, $saleId) {
                    $locked = Sale::whereKey($saleId)->lockForUpdate()->firstOrFail();
                    if ($locked->status !== 'confirmed' || SaleReturn::where('sale_id', $saleId)->exists()) {
                        throw AppError::conflict('FISCAL_SALE_CHANGED', 'La venta cambió mientras se preparaba la factura');
                    }
                    if ($rejected) {
                        $rejected->forceFill($values)->save();

                        return $rejected;
                    }

                    return FiscalInvoice::create($values);
                });
                $this->record($actor, $existing, 'fiscal.requested');
            } else {
                if ($existing->environment !== $setting->environment || $existing->cuit !== $setting->cuit || $existing->point_of_sale !== $setting->point_of_sale) {
                    throw AppError::conflict('FISCAL_CONFIG_CHANGED', 'Restaurá la configuración con la que se inició este comprobante para consultarlo');
                }
                $lookup = $this->arca->call($setting, 'FECompConsultar', '<FeCompConsReq><CbteTipo>'.$existing->voucher_type.'</CbteTipo><CbteNro>'.$existing->number.'</CbteNro><PtoVta>'.$existing->point_of_sale.'</PtoVta></FeCompConsReq>');
                $authorized = $lookup->xpath('.//*[local-name()="ResultGet"]')[0] ?? null;
                if ($authorized && ArcaClient::value($authorized, 'CodAutorizacion')) {
                    $request = $existing->payload['request'];
                    if (! Money::of(ArcaClient::value($authorized, 'ImpTotal') ?: '-1')->isEqualTo($request['ImpTotal']) || ArcaClient::value($authorized, 'DocNro') !== (string) $request['DocNro']) {
                        throw AppError::conflict('FISCAL_EXTERNAL_CONFLICT', 'El número está ocupado por otro comprobante. Se requiere revisión fiscal.');
                    }
                    foreach (['ImpNeto', 'ImpIVA', 'ImpOpEx', 'ImpTotConc'] as $field) {
                        if (! Money::of(ArcaClient::value($authorized, $field) ?: '-1')->isEqualTo($request[$field])) {
                            throw AppError::conflict('FISCAL_EXTERNAL_CONFLICT', 'Los importes fiscales recuperados no coinciden con el pedido original');
                        }
                    }
                    foreach (['DocTipo', 'CbteFch', 'MonId'] as $field) {
                        if (ArcaClient::value($authorized, $field) !== (string) $request[$field]) {
                            throw AppError::conflict('FISCAL_EXTERNAL_CONFLICT', 'Los datos recuperados no coinciden con el pedido original');
                        }
                    }

                    return $this->authorized($actor, $existing, ArcaClient::value($authorized, 'CodAutorizacion'), ArcaClient::value($authorized, 'FchVto'));
                }
                $errors = $lookup->xpath('.//*[local-name()="Errors"]/*[local-name()="Err"]');
                if (! $errors || count($errors) !== 1 || ArcaClient::value($errors[0], 'Code') !== '602') {
                    ArcaClient::assertNoErrors($lookup);
                    throw AppError::conflict('FISCAL_UNCERTAIN', 'ARCA no confirmó si existe el comprobante. Volvé a consultarlo más tarde.');
                }
            }
            $payload = $existing->payload['request'];
            $payload = array_slice($payload, 0, 3, true) + ['CbteDesde' => $existing->number, 'CbteHasta' => $existing->number] + array_slice($payload, 3, null, true);
            $result = $this->arca->call($setting, 'FECAESolicitar', '<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>'.$existing->point_of_sale.'</PtoVta><CbteTipo>'.$existing->voucher_type.'</CbteTipo></FeCabReq><FeDetReq><FECAEDetRequest>'.FiscalPayload::xml($payload).'</FECAEDetRequest></FeDetReq></FeCAEReq>');
            $detail = $result->xpath('.//*[local-name()="FECAEDetResponse"]')[0] ?? null;
            if ($detail && ArcaClient::value($detail, 'Resultado') === 'A' && ArcaClient::value($detail, 'CAE')) {
                return $this->authorized($actor, $existing, ArcaClient::value($detail, 'CAE'), ArcaClient::value($detail, 'CAEFchVto'));
            }
            $messages = [];
            foreach ($result->xpath('.//*[local-name()="Msg"]') as $msg) {
                $messages[] = (string) $msg;
            }
            // Una respuesta sin detalle de rechazo sigue pendiente: puede ser un error transitorio.
            $status = $detail && ArcaClient::value($detail, 'Resultado') === 'R' ? 'rejected' : 'pending';
            $existing->forceFill(['status' => $status, 'message' => mb_substr(implode(' · ', $messages) ?: 'ARCA no confirmó la autorización. Consultá el mismo comprobante.', 0, 2000)])->save();
            $this->record($actor, $existing, 'fiscal.'.$status);

            return $existing;
        });
    }

    private function authorized(Actor $actor, FiscalInvoice $invoice, string $cae, string $expires): FiscalInvoice
    {
        $invoice->forceFill(['status' => 'authorized', 'cae' => $cae, 'cae_expires_on' => $expires, 'message' => null])->save();
        $this->record($actor, $invoice, 'fiscal.authorized');

        return $invoice;
    }

    private function record(Actor $actor, FiscalInvoice $invoice, string $action): void
    {
        $this->audit->record(['tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName, 'action' => $action, 'entityType' => 'fiscal_invoice', 'entityId' => $invoice->id, 'after' => ['saleId' => $invoice->sale_id, 'environment' => $invoice->environment, 'type' => $invoice->voucher_type, 'number' => $invoice->number, 'status' => $invoice->status, 'cae' => $invoice->cae], 'ip' => $actor->ip, 'requestId' => $actor->requestId]);
    }
}
