<?php

namespace App\Support;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/**
 * Aritmética de importes y cantidades sin punto flotante (equivale a packages/domain/src/money.ts).
 * Los valores viajan como texto decimal ("1234.50") y se operan con BigDecimal.
 */
final class Money
{
    /** Escala de los cocientes intermedios antes de redondear. */
    public const DIVISION_SCALE = 30;

    public static function of(string|int|BigDecimal $value): BigDecimal
    {
        return BigDecimal::of($value);
    }

    /** Redondea a 2 decimales con criterio half-up (comprobantes). */
    public static function round(string|int|BigDecimal $value): string
    {
        return (string) self::of($value)->toScale(2, RoundingMode::HalfUp);
    }

    /** Costos unitarios: 4 decimales. */
    public static function roundUnit(string|int|BigDecimal $value): string
    {
        return (string) self::of($value)->toScale(4, RoundingMode::HalfUp);
    }

    /** Cantidades (kilos, metros, unidades): 3 decimales. */
    public static function quantity(string|int|BigDecimal $value): string
    {
        return (string) self::of($value)->toScale(3, RoundingMode::HalfUp);
    }

    public static function divide(string|BigDecimal $a, string|BigDecimal $b): BigDecimal
    {
        return self::of($a)->dividedBy(self::of($b), self::DIVISION_SCALE, RoundingMode::HalfUp);
    }
}
