<?php

namespace Tests\Unit;

use App\Support\Money;
use PHPUnit\Framework\TestCase;

/** Importes y cantidades en los mensajes, como los muestra la web. */
class MoneyTest extends TestCase
{
    public function test_pesos_con_separador_de_miles_y_coma_decimal(): void
    {
        $this->assertSame('$ 45.000', Money::pesos('45000.00'));
        $this->assertSame('$ 1.234,50', Money::pesos('1234.5'));
        $this->assertSame('$ 0,99', Money::pesos('0.99'));
        $this->assertSame('-$ 5,41', Money::pesos('-5.41'));
    }

    public function test_cantidades_sin_ceros_que_parezcan_miles(): void
    {
        $this->assertSame('2', Money::plainQuantity('2.000'));
        $this->assertSame('0', Money::plainQuantity('0.000'));
        $this->assertSame('1,25', Money::plainQuantity('1.250'));
        $this->assertSame('100', Money::plainQuantity('100'));
        $this->assertSame('-3', Money::plainQuantity('-3.000'));
    }
}
