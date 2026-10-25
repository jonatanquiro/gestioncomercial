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

    private static function factor(string $percent): BigDecimal
    {
        return BigDecimal::one()->plus(Money::divide($percent, '100'));
    }
}
