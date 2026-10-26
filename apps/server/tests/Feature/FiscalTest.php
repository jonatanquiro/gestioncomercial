<?php

namespace Tests\Feature;

use App\Models\FiscalSetting;
use App\Support\OpenSslConfig;
use App\Tenancy\TenantContext;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class FiscalTest extends TestCase
{
    private function prepare(): array
    {
        $registration = $this->registerTenant();
        $owner = $registration['client'];
        $config = ['environment' => 'homologacion', 'cuit' => '20123456786', 'pointOfSale' => 3, 'credentialMode' => 'own'];
        $this->assertSame(200, $owner->put('/fiscal/settings', $config)->status);
        $csr = $owner->post('/fiscal/csr', ['environment' => 'homologacion', 'cuit' => '20123456786', 'alias' => 'prueba', 'organization' => 'Prueba']);
        $this->assertSame(200, $csr->status, json_encode($csr->body));
        $pem = app(TenantContext::class)->run($registration['tenantId'], fn () => Crypt::decryptString(FiscalSetting::first()->private_key_enc));
        $certificate = openssl_csr_sign($csr->body['csr'], null, openssl_pkey_get_private($pem), 1, ['digest_alg' => 'sha256', ...OpenSslConfig::options()]);
        openssl_x509_export($certificate, $certificatePem);
        $saved = $owner->put('/fiscal/settings', [...$config, 'certificatePem' => $certificatePem]);
        $this->assertSame(200, $saved->status, json_encode($saved->body));
        $this->assertTrue($saved->body['hasCertificate']);
        $this->assertStringNotContainsString('PRIVATE KEY', json_encode($owner->get('/fiscal/settings')->body));
        $register = $owner->get('/registers')->body[0];
        $owner->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '0']);
        $product = $this->createProduct($owner, ['price' => '121', 'initialStock' => '2']);
        $cash = collect($owner->get('/payment-methods')->body)->firstWhere('kind', 'cash');
        $sale = $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']], 'payments' => [['paymentMethodId' => $cash['id'], 'amount' => '121']], 'expectedTotal' => '121.00']);
        $this->assertSame(201, $sale->status);

        return [$owner, $sale->body['id']];
    }

    private function body(): array
    {
        return ['environment' => 'homologacion', 'voucherType' => 11, 'documentType' => 99, 'documentNumber' => '0', 'buyerName' => 'Consumidor final', 'vatCondition' => 5];
    }

    private function response(string $method, string $body)
    {
        return Http::response('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><'.$method.'Response><'.$method.'Result>'.$body.'</'.$method.'Result></'.$method.'Response></soap:Body></soap:Envelope>', 200);
    }

    private function ticket()
    {
        return Http::response('<Envelope><Body><loginCmsResponse><loginCmsReturn><![CDATA[<loginTicketResponse><header><expirationTime>'.now()->addHours(12)->toIso8601String().'</expirationTime></header><credentials><token>test-token</token><sign>test-sign</sign></credentials></loginTicketResponse>]]></loginCmsReturn></loginCmsResponse></Body></Envelope>');
    }

    public function test_emite_cae_sin_exponer_credenciales_y_reintento_no_duplica(): void
    {
        [$owner, $sale] = $this->prepare();
        Http::preventStrayRequests();
        Http::fake(function ($request) {
            $xml = $request->body();
            if (str_contains($xml, '<loginCms')) {
                return $this->ticket();
            }
            if (str_contains($xml, '<FECompUltimoAutorizado')) {
                return $this->response('FECompUltimoAutorizado', '<CbteNro>0</CbteNro>');
            }
            $this->assertStringContainsString('<ImpNeto>121.00</ImpNeto>', $xml);
            $this->assertStringContainsString('<CondicionIVAReceptorId>5</CondicionIVAReceptorId>', $xml);

            return $this->response('FECAESolicitar', '<FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>12345678901234</CAE><CAEFchVto>20261105</CAEFchVto></FECAEDetResponse></FeDetResp>');
        });
        $res = $owner->post("/sales/{$sale}/invoice", $this->body());
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame('authorized', $res->body['status']);
        $this->assertSame(1, $res->body['number']);
        $retry = $owner->post("/sales/{$sale}/invoice", $this->body());
        $this->assertSame($res->body['id'], $retry->body['id']);
        Http::assertSentCount(3);
        $audit = json_encode($owner->get('/audit')->body);
        $this->assertStringNotContainsString('test-token', $audit);
        $this->assertStringNotContainsString('PRIVATE KEY', $audit);
    }

    public function test_timeout_conserva_numero_y_recupera_cae_mediante_consulta(): void
    {
        [$owner, $sale] = $this->prepare();
        Http::preventStrayRequests();
        Http::fake(function ($request) {
            $xml = $request->body();
            if (str_contains($xml, '<loginCms')) {
                return $this->ticket();
            }
            if (str_contains($xml, '<FECompUltimoAutorizado')) {
                return $this->response('FECompUltimoAutorizado', '<CbteNro>10</CbteNro>');
            }
            if (str_contains($xml, '<FECAESolicitar')) {
                throw new ConnectionException('Timeout simulado');
            }

            return $this->response('FECompConsultar', '<ResultGet><CodAutorizacion>12345678901235</CodAutorizacion><FchVto>20261105</FchVto><ImpTotal>121.00</ImpTotal><ImpNeto>121.00</ImpNeto><ImpIVA>0.00</ImpIVA><ImpOpEx>0.00</ImpOpEx><ImpTotConc>0.00</ImpTotConc><DocNro>0</DocNro><DocTipo>99</DocTipo><CbteFch>'.now('America/Buenos_Aires')->format('Ymd').'</CbteFch><MonId>PES</MonId></ResultGet>');
        });
        $failed = $owner->post("/sales/{$sale}/invoice", $this->body());
        $this->assertSame([400, 'ARCA_CONNECTION'], [$failed->status, $failed->body['code']]);
        $pending = $owner->get('/fiscal/invoices')->body[0];
        $this->assertSame('pending', $pending['status']);
        $res = $owner->post("/sales/{$sale}/invoice", $this->body());
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame('authorized', $res->body['status']);
        $this->assertSame(11, $res->body['number']);
        $this->assertSame($pending['id'], $res->body['id']);
        // Las conexiones fallidas no se agregan al registro de respuestas de Http::fake.
        Http::assertSentCount(3);
        Http::assertSent(fn ($request) => str_contains($request->body(), '<FECompConsultar'));
    }
}
