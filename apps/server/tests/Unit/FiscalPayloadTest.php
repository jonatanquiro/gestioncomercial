<?php

namespace Tests\Unit;

use App\Services\ArcaClient;
use App\Services\FiscalPayload;
use App\Support\AppError;
use PHPUnit\Framework\TestCase;

class FiscalPayloadTest extends TestCase
{
    public function test_separa_iva_incluido_y_conserva_el_total(): void
    {
        $payload = (new FiscalPayload)->build('responsable_inscripto', 6, ['documentType' => 99, 'documentNumber' => '0', 'vatCondition' => 5], [['vatRate' => '21', 'total' => '121.00'], ['vatRate' => '10.5', 'total' => '110.50'], ['vatRate' => 'exento', 'total' => '10.00']], '241.50');
        $this->assertSame('200.00', $payload['ImpNeto']);
        $this->assertSame('31.50', $payload['ImpIVA']);
        $this->assertSame('10.00', $payload['ImpOpEx']);
        $this->assertCount(2, $payload['Iva']);
    }

    public function test_factura_c_no_discrimina_iva_del_monotributista(): void
    {
        $payload = (new FiscalPayload)->build('monotributo', 11, ['documentType' => 99, 'documentNumber' => '0', 'vatCondition' => 5], [['vatRate' => '21', 'total' => '121.00']], '121.00');
        $this->assertSame('121.00', $payload['ImpNeto']);
        $this->assertSame('0.00', $payload['ImpIVA']);
        $this->assertArrayNotHasKey('Iva', $payload);
    }

    public function test_rechaza_xml_con_entidades_externas(): void
    {
        $this->expectException(AppError::class);
        ArcaClient::xml('<!DOCTYPE test [<!ENTITY xx SYSTEM "file:///etc/passwd">]><test>&xx;</test>');
    }

    public function test_factura_a_exige_cuit_y_condicion_fiscal_del_receptor(): void
    {
        $payload = (new FiscalPayload)->build('responsable_inscripto', 1, ['documentType' => 80, 'documentNumber' => '30712345671', 'vatCondition' => 1], [['vatRate' => '21', 'total' => '121.00']], '121.00');
        $this->assertSame('100.00', $payload['ImpNeto']);
        $this->assertSame('21.00', $payload['ImpIVA']);
        $this->expectException(AppError::class);
        (new FiscalPayload)->build('responsable_inscripto', 1, ['documentType' => 99, 'documentNumber' => '0', 'vatCondition' => 5], [['vatRate' => '21', 'total' => '121.00']], '121.00');
    }
}
