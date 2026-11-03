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
use App\Models\SaleReturnLine;
use App\Models\Tenant;
use App\Support\AppError;
use App\Support\Money;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Comprobantes ARCA: la factura de una venta y las notas de crédito asociadas (ADR 0017). En los
 * dos casos el número se guarda antes de pedir el CAE, así un corte nunca genera otro número, y
 * un comprobante pendiente se consulta antes de volver a pedirlo.
 */
class FiscalIssuer
{
    /** Nota de crédito que corresponde a cada tipo de factura: A → 3, B → 8, C → 13. */
    public const CREDIT_NOTE_TYPES = [1 => 3, 6 => 8, 11 => 13];

    public function __construct(private readonly ArcaClient $arca, private readonly AuditService $audit, private readonly EntitlementsService $entitlements) {}

    public function issue(Actor $actor, string $saleId, array $input): FiscalInvoice
    {
        $setting = FiscalSetting::where('environment', $input['environment'])->first() ?? throw AppError::notFound('Configuración fiscal');

        return $this->locked($setting, function () use ($actor, $setting, $saleId, $input) {
            $sale = Sale::find($saleId) ?? throw AppError::notFound('Venta');
            $existing = FiscalInvoice::where('sale_id', $saleId)->where('environment', $setting->environment)->where('kind', 'invoice')->first();
            if ($existing?->status === 'authorized') {
                return $existing;
            }
            $rejected = $existing?->status === 'rejected' ? $existing : null;
            if ($rejected) {
                $existing = null;
            }
            if (! $existing) {
                $this->assertPlan();
            }
            if ($sale->status !== 'confirmed' || SaleReturn::where('sale_id', $saleId)->exists()) {
                throw AppError::badRequest('FISCAL_SALE', 'Solo se puede facturar una venta confirmada sin devoluciones');
            }
            $tenant = $this->assertIssuer($actor, $setting);
            $lines = SaleLine::where('sale_id', $saleId)->get();
            $productIds = ProductVariant::whereIn('id', $lines->pluck('variant_id'))->pluck('product_id');
            if (Product::whereIn('id', $productIds)->where('kind', 'service')->exists()) {
                throw AppError::badRequest('FISCAL_SERVICES', 'Esta primera integración factura bienes en ARS. Los servicios requieren concepto y fechas de prestación.');
            }
            $type = (int) $input['voucherType'];
            $prepare = fn () => [
                'payload' => app(FiscalPayload::class)->build($tenant->tax_condition, $type, $input, $lines->map(fn ($line) => ['vatRate' => $line->vat_rate, 'total' => $line->line_total])->all(), $sale->total),
                'values' => ['sale_id' => $saleId, 'kind' => 'invoice', 'buyerName' => $input['buyerName'], 'buyerAddress' => $input['buyerAddress'] ?? null],
            ];
            $stillValid = function () use ($saleId) {
                $locked = Sale::whereKey($saleId)->lockForUpdate()->firstOrFail();
                if ($locked->status !== 'confirmed' || SaleReturn::where('sale_id', $saleId)->exists()) {
                    throw AppError::conflict('FISCAL_SALE_CHANGED', 'La venta cambió mientras se preparaba la factura');
                }
            };

            return $this->submit($actor, $setting, $tenant, $existing, $rejected, $type, $prepare, $stillValid);
        });
    }

    /**
     * Nota de crédito de una devolución ($returnId) o de la anulación de la venta (null), asociada
     * a la factura autorizada en ese ambiente, por lo devuelto con sus alícuotas.
     */
    public function creditNote(Actor $actor, string $saleId, ?string $returnId, string $environment): FiscalInvoice
    {
        $setting = FiscalSetting::where('environment', $environment)->first() ?? throw AppError::notFound('Configuración fiscal');

        return $this->locked($setting, function () use ($actor, $setting, $saleId, $returnId) {
            $sale = Sale::find($saleId) ?? throw AppError::notFound('Venta');
            $invoice = FiscalInvoice::where('sale_id', $saleId)->where('environment', $setting->environment)->where('kind', 'invoice')->where('status', 'authorized')->first()
                ?? throw AppError::badRequest('FISCAL_NO_INVOICE', 'La venta no tiene una factura autorizada en este ambiente');
            $existing = FiscalInvoice::where('sale_id', $saleId)->where('environment', $setting->environment)->where('kind', 'credit_note')
                ->where(fn ($q) => $returnId ? $q->where('sale_return_id', $returnId) : $q->whereNull('sale_return_id'))->first();
            if ($existing?->status === 'authorized') {
                return $existing;
            }
            $rejected = $existing?->status === 'rejected' ? $existing : null;
            if ($rejected) {
                $existing = null;
            }
            if (! $existing) {
                $this->assertPlan();
            }
            if ($returnId) {
                $saleReturn = SaleReturn::where('sale_id', $saleId)->whereKey($returnId)->first() ?? throw AppError::notFound('Devolución');
                $saleLines = SaleLine::where('sale_id', $saleId)->get()->keyBy('id');
                $lines = SaleReturnLine::where('return_id', $saleReturn->id)->get()->map(fn ($l) => ['vatRate' => $saleLines[$l->sale_line_id]->vat_rate, 'total' => $l->amount])->all();
                $total = $saleReturn->total;
            } else {
                if ($sale->status !== 'voided') {
                    throw AppError::badRequest('FISCAL_NOT_VOIDED', 'La nota de crédito por anulación es para una venta anulada');
                }
                $lines = SaleLine::where('sale_id', $saleId)->get()->map(fn ($l) => ['vatRate' => $l->vat_rate, 'total' => $l->line_total])->all();
                $total = $sale->total;
            }
            $tenant = $this->assertIssuer($actor, $setting);
            $type = self::CREDIT_NOTE_TYPES[$invoice->voucher_type] ?? throw AppError::badRequest('FISCAL_TYPE', 'El tipo de la factura no admite nota de crédito');
            $original = $invoice->payload['request'];
            $prepare = function () use ($tenant, $invoice, $original, $lines, $total, $saleId, $returnId) {
                $buyer = ['documentType' => (int) $original['DocTipo'], 'documentNumber' => (string) $original['DocNro'], 'vatCondition' => (int) $original['CondicionIVAReceptorId']];
                $payload = app(FiscalPayload::class)->build($tenant->tax_condition, $invoice->voucher_type, $buyer, $lines, Money::round($total));
                // La nota de crédito informa la factura que corrige, antes del detalle de IVA.
                $associated = ['Tipo' => $invoice->voucher_type, 'PtoVta' => $invoice->point_of_sale, 'Nro' => $invoice->number, 'Cuit' => $invoice->cuit, 'CbteFch' => $original['CbteFch']];
                $iva = $payload['Iva'] ?? null;
                unset($payload['Iva']);
                $payload['CbtesAsoc'] = [$associated];
                if ($iva) {
                    $payload['Iva'] = $iva;
                }

                return [
                    'payload' => $payload,
                    'values' => ['sale_id' => $saleId, 'kind' => 'credit_note', 'sale_return_id' => $returnId, 'associated_invoice_id' => $invoice->id,
                        'buyerName' => $invoice->payload['buyerName'] ?? '', 'buyerAddress' => $invoice->payload['buyerAddress'] ?? null],
                ];
            };

            return $this->submit($actor, $setting, $tenant, $existing, $rejected, $type, $prepare, fn () => null);
        });
    }

    private function locked(FiscalSetting $setting, \Closure $fn): FiscalInvoice
    {
        return Cache::lock('arca-issuer-'.$setting->tenant_id.'-'.$setting->environment, 300)->block(5, $fn);
    }

    private function assertPlan(): void
    {
        if (! in_array('fiscal_arca', $this->entitlements->plan()['features'] ?? [], true)) {
            throw AppError::badRequest('FISCAL_PLAN', 'El plan actual no incluye nuevas emisiones ARCA. Los comprobantes anteriores se conservan y los pendientes pueden consultarse.');
        }
    }

    private function assertIssuer(Actor $actor, FiscalSetting $setting): Tenant
    {
        $tenant = Tenant::find($actor->tenantId);
        if ($setting->environment === 'produccion' && (! $tenant->cuit || ! $tenant->legal_name || ! $tenant->address || empty($setting->issuer_metadata['grossIncomeNumber']) || empty($setting->issuer_metadata['activityStartDate']))) {
            throw AppError::badRequest('FISCAL_ISSUER_DATA', 'Completá CUIT, razón social y domicilio del comercio, e Ingresos Brutos y fecha de inicio de actividades, antes de emitir en producción');
        }
        if ($tenant->cuit && $tenant->cuit !== $setting->cuit) {
            throw AppError::badRequest('FISCAL_CUIT', 'El CUIT del emisor configurado debe coincidir con el del comercio');
        }

        return $tenant;
    }

    /**
     * Pide el CAE de un comprobante nuevo, o consulta y completa uno pendiente.
     *
     * @param  \Closure(): array{payload: array, values: array}  $prepare
     * @param  \Closure(): void  $stillValid  se corre con la venta bloqueada antes de guardar el número
     */
    private function submit(Actor $actor, FiscalSetting $setting, Tenant $tenant, ?FiscalInvoice $existing, ?FiscalInvoice $rejected, int $type, \Closure $prepare, \Closure $stillValid): FiscalInvoice
    {
        if (! $existing) {
            if (FiscalInvoice::where('environment', $setting->environment)->where('status', 'pending')->exists()) {
                throw AppError::conflict('FISCAL_PENDING', 'Hay un comprobante con respuesta pendiente. Consultalo o reintentá esa misma venta antes de emitir otra.');
            }
            ['payload' => $payload, 'values' => $data] = $prepare();
            $last = $this->arca->call($setting, 'FECompUltimoAutorizado', '<PtoVta>'.$setting->point_of_sale.'</PtoVta><CbteTipo>'.$type.'</CbteTipo>');
            ArcaClient::assertNoErrors($last);
            $lastNumber = ArcaClient::value($last, 'CbteNro');
            if (! preg_match('/^\d+$/', $lastNumber)) {
                throw AppError::badRequest('ARCA_NUMBER', 'ARCA no confirmó el último número autorizado');
            }
            $number = (int) $lastNumber + 1;
            // La intención y el número se guardan ANTES de solicitar autorización: un timeout nunca genera otro número.
            $values = [
                'sale_id' => $data['sale_id'], 'kind' => $data['kind'], 'sale_return_id' => $data['sale_return_id'] ?? null, 'associated_invoice_id' => $data['associated_invoice_id'] ?? null,
                'environment' => $setting->environment, 'cuit' => $setting->cuit, 'point_of_sale' => $setting->point_of_sale, 'voucher_type' => $type, 'number' => $number,
                'status' => 'pending', 'message' => null,
                'payload' => ['request' => $payload, 'buyerName' => $data['buyerName'], 'issuerName' => $tenant->legal_name ?: $tenant->trade_name, 'issuerAddress' => $tenant->address, 'issuerTaxCondition' => $tenant->tax_condition, 'issuerMetadata' => $setting->issuer_metadata, 'buyerAddress' => $data['buyerAddress']],
                'created_by' => $actor->userId,
            ];
            $existing = DB::transaction(function () use ($rejected, $values, $stillValid) {
                $stillValid();
                if ($rejected) {
                    $rejected->forceFill($values)->save();

                    return $rejected;
                }

                return FiscalInvoice::create($values);
            });
            $this->record($actor, $existing, 'fiscal.requested');
        } else {
            if ($existing->cuit !== $setting->cuit || $existing->point_of_sale !== $setting->point_of_sale) {
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
    }

    private function authorized(Actor $actor, FiscalInvoice $invoice, string $cae, string $expires): FiscalInvoice
    {
        $invoice->forceFill(['status' => 'authorized', 'cae' => $cae, 'cae_expires_on' => $expires, 'message' => null])->save();
        $this->record($actor, $invoice, 'fiscal.authorized');

        return $invoice;
    }

    private function record(Actor $actor, FiscalInvoice $invoice, string $action): void
    {
        $this->audit->record(['tenantId' => $actor->tenantId, 'actorType' => 'user', 'actorId' => $actor->userId, 'actorName' => $actor->userName, 'action' => $action, 'entityType' => 'fiscal_invoice', 'entityId' => $invoice->id, 'after' => ['saleId' => $invoice->sale_id, 'kind' => $invoice->kind, 'saleReturnId' => $invoice->sale_return_id, 'environment' => $invoice->environment, 'type' => $invoice->voucher_type, 'number' => $invoice->number, 'status' => $invoice->status, 'cae' => $invoice->cae], 'ip' => $actor->ip, 'requestId' => $actor->requestId]);
    }
}
