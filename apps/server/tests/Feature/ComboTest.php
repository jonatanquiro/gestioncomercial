<?php

namespace Tests\Feature;

use Tests\TestCase;

/** Combos (ADR 0024): varios productos por un precio, aplicado solo en la caja. */
class ComboTest extends TestCase
{
    private function shop(): array
    {
        $t = $this->registerTenant();
        $this->usePlan($t['tenantId'], ['promotions']);
        $register = $t['client']->get('/registers')->body[0];
        $this->assertSame(201, $t['client']->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '0'])->status);
        $cash = collect($t['client']->get('/payment-methods')->body)->firstWhere('kind', 'cash');

        return $t + ['register' => $register, 'cash' => $cash];
    }

    private static function combo(array $items, string $price, array $overrides = []): array
    {
        return $overrides + ['name' => 'Pancho completo', 'kind' => 'combo', 'percent' => null, 'buyQuantity' => null, 'payQuantity' => null, 'comboPrice' => $price,
            'items' => $items, 'scope' => 'all', 'categoryId' => null, 'productId' => null, 'startsOn' => null, 'endsOn' => null];
    }

    public function test_combo_completo_doble_y_parcial(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $salchichas = $this->createProduct($owner, ['name' => 'Salchichas x6', 'price' => '3000', 'initialStock' => '20']);
        $pan = $this->createProduct($owner, ['name' => 'Pan de viena x6', 'price' => '1500', 'initialStock' => '20']);
        $mayonesa = $this->createProduct($owner, ['name' => 'Mayonesa', 'price' => '2500', 'initialStock' => '20']);
        $res = $owner->post('/promotions', self::combo([['productId' => $salchichas['id'], 'quantity' => 1], ['productId' => $pan['id'], 'quantity' => 1], ['productId' => $mayonesa['id'], 'quantity' => 1]], '6000'));
        $this->assertSame(201, $res->status, json_encode($res->body));
        $this->assertSame(['6000.00', '7000.00', 3], [$res->body['comboPrice'], $res->body['regularPrice'], count($res->body['items'])]);

        $line = fn (array $p, string $q) => ['variantId' => $p['variantId'], 'quantity' => $q];
        // Con todo: 7000 → 6000, el descuento repartido según lo que aporta cada uno.
        $quote = $owner->post('/sales/quote', ['lines' => [$line($salchichas, '1'), $line($pan, '1'), $line($mayonesa, '1')]])->body;
        $this->assertSame('6000.00', $quote['total']);
        $this->assertSame(['428.57', '214.29', '357.14'], array_column($quote['lines'], 'promotionDiscount'));
        $this->assertSame(['Pancho completo'], array_values(array_unique(array_column($quote['lines'], 'promotionName'))));
        // Dos salchichas y dos panes pero una mayonesa: un solo combo; lo demás a precio normal.
        $this->assertSame(['10500.00'], [$owner->post('/sales/quote', ['lines' => [$line($salchichas, '2'), $line($pan, '2'), $line($mayonesa, '1')]])->body['total']]);
        // Doble: dos combos.
        $this->assertSame('12000.00', $owner->post('/sales/quote', ['lines' => [$line($salchichas, '2'), $line($pan, '2'), $line($mayonesa, '2')]])->body['total']);
        // Falta uno: no hay combo.
        $this->assertSame('4500.00', $owner->post('/sales/quote', ['lines' => [$line($salchichas, '1'), $line($pan, '1')]])->body['total']);

        // La venta cobra lo cotizado y guarda la promoción en cada línea.
        $sale = $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'lines' => [$line($salchichas, '1'), $line($pan, '1'), $line($mayonesa, '1')],
            'payments' => [['paymentMethodId' => $shop['cash']['id'], 'amount' => '6000']], 'expectedTotal' => '6000.00']);
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $this->assertSame(['6000.00', '3000.00'], [$sale->body['total'], $sale->body['lines'][0]['unitPrice']]);
        $this->assertSame('Pancho completo', $sale->body['lines'][2]['promotionName']);
    }

    public function test_no_acumula_con_otras_promociones_ni_con_descuento_manual(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $a = $this->createProduct($owner, ['name' => 'Fernet', 'price' => '10000', 'initialStock' => '10']);
        $b = $this->createProduct($owner, ['name' => 'Gaseosa', 'price' => '2000', 'initialStock' => '10']);
        $owner->post('/promotions', self::combo([['productId' => $a['id'], 'quantity' => 1], ['productId' => $b['id'], 'quantity' => 2]], '12000', ['name' => 'Fernet con 2 gaseosas']));
        $owner->post('/promotions', ['name' => '10% todo', 'kind' => 'percent', 'percent' => '10', 'buyQuantity' => null, 'payQuantity' => null, 'scope' => 'all', 'categoryId' => null, 'productId' => null, 'startsOn' => null, 'endsOn' => null]);
        $quote = $owner->post('/sales/quote', ['lines' => [['variantId' => $a['variantId'], 'quantity' => '1'], ['variantId' => $b['variantId'], 'quantity' => '2']]])->body;
        // 14000 → 12000 por el combo; el 10% no se suma encima.
        $this->assertSame(['12000.00', 'Fernet con 2 gaseosas'], [$quote['total'], $quote['lines'][1]['promotionName']]);
        // Con descuento manual en una línea, no hay combo: queda el 10% en la otra.
        $manual = $owner->post('/sales/quote', ['lines' => [['variantId' => $a['variantId'], 'quantity' => '1', 'discountPercent' => '5'], ['variantId' => $b['variantId'], 'quantity' => '2']]])->body;
        $this->assertSame('13100.00', $manual['total']);
    }

    public function test_validaciones_del_combo(): void
    {
        ['client' => $owner] = $this->shop();
        $a = $this->createProduct($owner, ['price' => '1000']);
        $queso = $this->createProduct($owner, ['price' => '9000', 'saleMode' => 'weight']);
        $detail = fn ($res) => [$res->body['details'][0]['path'] ?? null, $res->body['details'][0]['message'] ?? null];
        $this->assertSame(['comboPrice', 'Ingresá el precio del combo'], $detail($owner->post('/promotions', self::combo([['productId' => $a['id'], 'quantity' => 2]], ''))));
        $this->assertSame(['items', 'El combo tiene que llevar al menos dos unidades'], $detail($owner->post('/promotions', self::combo([['productId' => $a['id'], 'quantity' => 1]], '500'))));
        $this->assertSame('items', $detail($owner->post('/promotions', self::combo([['productId' => $a['id'], 'quantity' => 1], ['productId' => $queso['id'], 'quantity' => 1]], '500')))[0]);
        $this->assertSame(201, $owner->post('/promotions', self::combo([['productId' => $a['id'], 'quantity' => 2]], '1500', ['name' => '2 por 1500']))->status);
    }
}
