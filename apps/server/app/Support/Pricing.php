<?php

namespace App\Support;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use InvalidArgumentException;

/**
 * Recargo, margen y redondeo de precios: mismos cálculos que packages/domain/src/pricing.ts.
 * Los dos lados corren los casos de packages/domain/src/pricing-cases.json (PricingTest).
 */
final class Pricing
{
    /** Precio con recargo porcentual sobre el costo: P = C × (1 + r). */
    public static function priceFromMarkup(string $cost, string $markupPercent): string
    {
        return Money::round(Money::of($cost)->multipliedBy(self::factor($markupPercent)));
    }

    /** Precio con margen porcentual sobre el precio de venta: P = C / (1 − m). */
    public static function priceFromMargin(string $cost, string $marginPercent): string
    {
        $m = Money::divide($marginPercent, '100');
        if ($m->isGreaterThanOrEqualTo(1)) {
            throw new InvalidArgumentException('El margen debe ser menor a 100%');
        }

        return Money::round(Money::divide($cost, BigDecimal::one()->minus($m)));
    }

    /** Recargo equivalente: (P − C) / C. */
    public static function markupPercentOf(string $cost, string $price): string
    {
        if (Money::of($cost)->isZero()) {
            throw new InvalidArgumentException('Costo cero: el recargo no está definido');
        }

        return Money::round(Money::divide(Money::of($price)->minus($cost), $cost)->multipliedBy(100));
    }

    /** Margen equivalente: (P − C) / P. */
    public static function marginPercentOf(string $cost, string $price): string
    {
        if (Money::of($price)->isZero()) {
            throw new InvalidArgumentException('Precio cero: el margen no está definido');
        }

        return Money::round(Money::divide(Money::of($price)->minus($cost), $price)->multipliedBy(100));
    }

    /** Precio aumentado (o bajado, con signo negativo) un porcentaje. */
    public static function priceFromPercent(string $price, string $percent): string
    {
        return Money::round(Money::of($price)->multipliedBy(self::factor($percent)));
    }

    /** Precio más (o menos) un monto fijo. */
    public static function priceFromFixed(string $price, string $amount): string
    {
        return Money::round(Money::of($price)->plus($amount));
    }

    /** Variación porcentual entre dos precios. */
    public static function variationPercent(string $oldPrice, string $newPrice): string
    {
        if (Money::of($oldPrice)->isZero()) {
            throw new InvalidArgumentException('Precio anterior cero: la variación no está definida');
        }

        return Money::round(Money::divide(Money::of($newPrice)->minus($oldPrice), $oldPrice)->multipliedBy(100));
    }

    /** Redondea un precio hacia arriba al múltiplo indicado (0 = sin redondeo). */
    public static function roundPriceUp(string $price, int $step): string
    {
        if ($step <= 0) {
            return Money::round($price);
        }

        return Money::round(Money::of($price)->dividedBy($step, 0, RoundingMode::Ceiling)->multipliedBy($step));
    }

    public static function roundMoney(string $value): string
    {
        return Money::round($value);
    }

    /**
     * Importes de una línea de venta: bruto = cantidad × precio, descuento = bruto × % / 100,
     * total = bruto − descuento. Cada paso se redondea a 2 decimales.
     *
     * @return array{gross: string, discount: string, total: string}
     */
    public static function saleLine(string $quantity, string $unitPrice, string $discountPercent = '0'): array
    {
        $gross = Money::round(Money::of($quantity)->multipliedBy($unitPrice));
        $discount = Money::round(Money::divide(Money::of($gross)->multipliedBy($discountPercent), '100'));

        return ['gross' => $gross, 'discount' => $discount, 'total' => Money::round(Money::of($gross)->minus($discount))];
    }

    public static function lineGross(string $quantity, string $unitPrice): string
    {
        return self::saleLine($quantity, $unitPrice)['gross'];
    }

    public static function lineDiscount(string $quantity, string $unitPrice, string $discountPercent): string
    {
        return self::saleLine($quantity, $unitPrice, $discountPercent)['discount'];
    }

    public static function lineTotal(string $quantity, string $unitPrice, string $discountPercent): string
    {
        return self::saleLine($quantity, $unitPrice, $discountPercent)['total'];
    }

    /** Parte proporcional de un importe al devolver una cantidad: importe × devuelta / vendida. */
    public static function proportionalAmount(string $amount, string $part, string $whole): string
    {
        return Money::round(Money::divide(Money::of($amount)->multipliedBy($part), $whole));
    }

    /**
     * Pago mixto (ADR 0029): recargo de lista sobre lo que se paga con medios que no son de
     * contado. Lo pagado así cubre mercadería por N × contado / lista; el resto es recargo.
     */
    public static function mixedSurcharge(string $nonCash, string $cashTotal, string $listTotal): string
    {
        if (! Money::of($listTotal)->isGreaterThan($cashTotal) || ! Money::of($nonCash)->isPositive()) {
            return '0.00';
        }
        $covered = Money::round(Money::divide(Money::of($nonCash)->multipliedBy($cashTotal), $listTotal));

        return Money::round(Money::of($nonCash)->minus($covered));
    }

    /** Lo que hay que cobrar con un medio que no es de contado para cubrir $cashAmount de mercadería a precio de contado. */
    public static function listAmountFor(string $cashAmount, string $cashTotal, string $listTotal): string
    {
        $r = Money::of(Money::round($cashAmount));
        if (! Money::of($listTotal)->isGreaterThan($cashTotal) || ! $r->isPositive()) {
            return Money::round($cashAmount);
        }
        $covered = fn (BigDecimal $n) => Money::of(Money::round(Money::divide($n->multipliedBy($cashTotal), $listTotal)));
        $cent = BigDecimal::of('0.01');
        $n = Money::of(Money::round(Money::divide($r->multipliedBy($listTotal), $cashTotal)));
        while ($covered($n)->isLessThan($r)) {
            $n = $n->plus($cent);
        }
        while ($n->isGreaterThan($cent) && $covered($n->minus($cent))->isGreaterThanOrEqualTo($r)) {
            $n = $n->minus($cent);
        }

        return Money::round($n);
    }

    private static function factor(string $percent): BigDecimal
    {
        return BigDecimal::one()->plus(Money::divide($percent, '100'));
    }
}
