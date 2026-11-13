<?php

namespace Tests\Feature;

use App\Support\Pricing;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Mismos casos que packages/domain (TypeScript): el servidor y la web no pueden calcular distinto. */
class PricingTest extends TestCase
{
    public static function cases(): array
    {
        $file = dirname(__DIR__, 4).'/packages/domain/src/pricing-cases.json';
        $data = json_decode((string) file_get_contents($file), true);
        $out = [];
        foreach ($data['cases'] as $c) {
            $out["{$c['fn']}(".implode(', ', $c['args']).')'] = [$c['fn'], $c['args'], $c['expected']];
        }

        return $out;
    }

    #[DataProvider('cases')]
    public function test_caso_compartido(string $fn, array $args, string $expected): void
    {
        $this->assertTrue(method_exists(Pricing::class, $fn), "Falta Pricing::{$fn}");
        $this->assertSame($expected, Pricing::$fn(...$args));
    }

    public function test_rechaza_margen_de_100_o_mas(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Pricing::priceFromMargin('1000', '100');
    }
}
