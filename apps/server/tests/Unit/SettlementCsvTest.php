<?php

namespace Tests\Unit;

use App\Services\SettlementCsv;
use App\Support\AppError;
use PHPUnit\Framework\TestCase;

class SettlementCsvTest extends TestCase
{
    public function test_lee_comillas_bom_y_decimales_argentinos_sin_perder_centavos(): void
    {
        $rows = (new SettlementCsv)->parse("\xEF\xBB\xBFoperacion;bruto;deducciones;fecha\r\nABC;\"1.250,50\";\"25,01\";2026-10-26\r\n", ';', ',', ['reference' => 0, 'gross' => 1, 'fees' => 2, 'date' => 3]);
        $this->assertSame('1250.50', $rows[0]['gross']);
        $this->assertSame('1225.49', $rows[0]['net']);
        $this->assertSame('ABC', $rows[0]['external_id']);
    }

    public function test_calcula_deducciones_con_neto_y_decimal_punto(): void
    {
        $rows = (new SettlementCsv)->parse("id,gross,net\nA,100.25,98.20", ',', '.', ['reference' => 0, 'gross' => 1, 'net' => 2]);
        $this->assertSame('2.05', $rows[0]['fees']);
    }

    public function test_rechaza_operaciones_repetidas_e_importes_inconsistentes(): void
    {
        foreach (["id;bruto;fee\nA;100;2\nA;100;2", "id;bruto;fee\nA;-100;2", "id;bruto;fee\nA;100;101", "id;bruto;fee\nA;1,234;0", "id;bruto;fee\nA;1.2,30;0", "id;bruto;fee\n;100;2"] as $csv) {
            try {
                (new SettlementCsv)->parse($csv, ';', ',', ['reference' => 0, 'gross' => 1, 'fees' => 2]);
                $this->fail('Se aceptó un archivo inválido');
            } catch (AppError $e) {
                $this->assertSame(400, $e->status);
            }
        }
    }
}
