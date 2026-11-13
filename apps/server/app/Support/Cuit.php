<?php

namespace App\Support;

/** CUIT/CUIL argentino: 11 dígitos con dígito verificador módulo 11 (igual que packages/contracts/src/cuit.ts). */
class Cuit
{
    public static function normalize(string $raw): string
    {
        return preg_replace('/[-\s]/', '', $raw) ?? '';
    }

    public static function isValid(string $raw): bool
    {
        $digits = self::normalize($raw);
        if (! preg_match('/^\d{11}$/', $digits)) {
            return false;
        }
        $weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        $sum = 0;
        foreach ($weights as $i => $w) {
            $sum += $w * (int) $digits[$i];
        }
        $mod = 11 - ($sum % 11);
        $check = $mod === 11 ? 0 : ($mod === 10 ? 9 : $mod);

        return $check === (int) $digits[10];
    }
}
