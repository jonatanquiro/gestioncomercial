<?php

namespace Tests\Feature;

use Illuminate\Support\Carbon;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** Promociones (ADR 0020): porcentaje y N×M, vigencia, sin acumular y total cotizado igual al cobrado. */
class PromotionsTest extends TestCase
{
    private function shop(string $plan = 'profesional'): array
    {
        $t = $this->registerTenant();
        $this->usePlan($t['tenantId'], $plan === 'inicial' ? ['fiscal_arca'] : ['fiscal_arca', 'advanced_reports', 'promotions']);
        $register = $t['client']->get('/registers')->body[0];
        $this->assertSame(201, $t['client']->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '0'])->status);
        $cash = collect($t['client']->get('/payment-methods')->body)->firstWhere('kind', 'cash');

        return $t + ['register' => $register, 'cash' => $cash];
    }

    private static function promotion(array $overrides = []): array
    {
        return $overrides + ['name' => 'Promo', 'kind' => 'percent', 'percent' => '20', 'buyQuantity' => null, 'payQuantity' => null, 'scope' => 'all', 'categoryId' => null, 'productId' => null, 'startsOn' => null, 'endsOn' => null];
    }

    private function sell(ApiClient $client, array $shop, array $lines, string $total)
    {
        return $client->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'lines' => $lines,
            'payments' => [['paymentMethodId' => $shop['cash']['id'], 'amount' => $total]], 'expectedTotal' => $total,
        ]);
    }

    public function test_porcentaje_por_categoria_y_3x2_con_la_mas_barata_gratis(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $remeras = collect($owner->get('/categories')->body)->first()['id'];
        $remera = $this->createProduct($owner, ['name' => 'Remera', 'price' => '10000', 'categoryId' => $remeras, 'initialStock' => '20']);
        $medias = $this->createProduct($owner, ['name' => 'Medias', 'price' => '2000', 'initialStock' => '20']);
        $soquetes = $this->createProduct($owner, ['name' => 'Soquetes', 'price' => '1500', 'initialStock' => '20']);

        $this->assertSame(201, $owner->post('/promotions', self::promotion(['name' => '20% en remeras', 'scope' => 'category', 'categoryId' => $remeras]))->status);
        $nxm = $owner->post('/promotions', self::promotion(['name' => '3x2 en medias', 'kind' => 'nxm', 'percent' => null, 'buyQuantity' => 3, 'payQuantity' => 2, 'scope' => 'all']));
        $this->assertSame(201, $nxm->status, json_encode($nxm->body));
        $this->assertTrue($nxm->body['current']);
        $this->assertSame('payQuantity', $owner->post('/promotions', self::promotion(['kind' => 'nxm', 'buyQuantity' => 2, 'payQuantity' => 2]))->body['details'][0]['path']);

        // Las remeras tienen 20% y no suman para el 3x2: 2 medias + 1 soquete = 3 unidades → el más barato (soquete) gratis.
        $lines = [['variantId' => $remera['variantId'], 'quantity' => '2'], ['variantId' => $medias['variantId'], 'quantity' => '2'], ['variantId' => $soquetes['variantId'], 'quantity' => '1']];
        $quote = $owner->post('/sales/quote', ['lines' => $lines]);
        $this->assertSame(200, $quote->status, json_encode($quote->body));
        $this->assertSame(['20% en remeras', null, '3x2 en medias'], array_column($quote->body['lines'], 'promotionName'));
        $this->assertSame(['16000.00', '4000.00', '0.00'], array_column($quote->body['lines'], 'total'));
        $this->assertSame(['25500.00', '5500.00', '20000.00'], [$quote->body['subtotal'], $quote->body['discountTotal'], $quote->body['total']]);

        // Cobrar con el total sin promociones da PRICE_CHANGED; con el cotizado, pasa y la línea guarda la promoción.
        $this->assertSame('PRICE_CHANGED', $this->sell($owner, $shop, $lines, '25500.00')->body['code']);
        $sale = $this->sell($owner, $shop, $lines, '20000.00');
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $this->assertSame(['20% en remeras', '4000.00'], [$sale->body['lines'][0]['promotionName'], $sale->body['lines'][0]['promotionDiscount']]);
        $this->assertSame('5500.00', $sale->body['discountTotal']);

        // 2 remeras y 2 medias: con el porcentaje en las remeras, las medias solas no llegan al 3x2.
        $two = $owner->post('/sales/quote', ['lines' => [['variantId' => $remera['variantId'], 'quantity' => '2'], ['variantId' => $medias['variantId'], 'quantity' => '2']]])->body;
        $this->assertSame(['20% en remeras', null], array_column($two['lines'], 'promotionName'));

        // Con descuento manual la línea no recibe promoción.
        $manual = $owner->post('/sales/quote', ['lines' => [['variantId' => $remera['variantId'], 'quantity' => '1', 'discountPercent' => '5']]])->body;
        $this->assertSame([null, '9500.00'], [$manual['lines'][0]['promotionName'], $manual['total']]);
    }

    public function test_vigencia_estado_y_plan(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['price' => '1000', 'initialStock' => '10']);
        $line = [['variantId' => $p['variantId'], 'quantity' => '1']];
        $tomorrow = Carbon::now('America/Buenos_Aires')->addDay()->toDateString();
        $future = $owner->post('/promotions', self::promotion(['scope' => 'product', 'productId' => $p['id'], 'startsOn' => $tomorrow]))->body;
        $this->assertFalse($future['current']);
        $this->assertSame('1000.00', $owner->post('/sales/quote', ['lines' => $line])->body['total']);
        $this->assertSame([], $owner->get('/pos/promotions')->body);

        $now = $owner->put("/promotions/{$future['id']}", [...self::promotion(['scope' => 'product', 'productId' => $p['id']]), 'status' => 'active'])->body;
        $this->assertTrue($now['current']);
        $this->assertSame('800.00', $owner->post('/sales/quote', ['lines' => $line])->body['total']);
        $this->assertSame([$now['name']], array_column($owner->get('/pos/promotions')->body, 'name'));
        $owner->put("/promotions/{$future['id']}", [...self::promotion(['scope' => 'product', 'productId' => $p['id']]), 'status' => 'inactive']);
        $this->assertSame('1000.00', $owner->post('/sales/quote', ['lines' => $line])->body['total']);

        // Sin el plan no se crean ni se aplican.
        $basic = $this->shop('inicial');
        $this->assertSame('PROMOTIONS_PLAN', $basic['client']->post('/promotions', self::promotion())->body['code']);
    }

    public function test_el_cajero_cotiza_pero_no_administra_promociones(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        ['client' => $cashier] = $this->addEmployee($owner, $this->roleByTemplate($owner, 'cashier')['id'], $shop['me']['branchIds']);
        $this->assertSame(403, $cashier->get('/promotions')->status);
        $p = $this->createProduct($owner, ['price' => '1000', 'initialStock' => '10']);
        $this->assertSame(200, $cashier->post('/sales/quote', ['lines' => [['variantId' => $p['variantId'], 'quantity' => '1']]])->status);
    }
}
