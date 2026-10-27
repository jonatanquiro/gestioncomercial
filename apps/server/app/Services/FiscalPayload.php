<?php

namespace App\Services;

use App\Support\AppError;
use App\Support\Money;
use Brick\Math\RoundingMode;

/** Importes de bienes en ARS, con IVA incluido y las alícuotas congeladas de la venta. */
class FiscalPayload
{
    public function build(string $taxCondition, int $type, array $buyer, array $lines, string $total): array
    {
        if (($taxCondition === 'responsable_inscripto' && ! in_array($type, [1, 6], true)) || ($taxCondition !== 'responsable_inscripto' && $type !== 11)) {
            throw AppError::badRequest('FISCAL_TYPE', 'El tipo de factura no corresponde a la condición fiscal del emisor');
        }
        if ($type === 1 && ($buyer['documentType'] !== 80 || ! in_array($buyer['vatCondition'], [1, 6], true))) {
            throw AppError::badRequest('FISCAL_BUYER', 'Para factura A, informá CUIT y condición de responsable inscripto o monotributista');
        }
        $payload = ['Concepto' => 1, 'DocTipo' => $buyer['documentType'], 'DocNro' => $buyer['documentNumber'], 'CbteFch' => now('America/Buenos_Aires')->format('Ymd'), 'ImpTotal' => Money::round($total), 'ImpTotConc' => '0.00', 'ImpNeto' => '0.00', 'ImpOpEx' => '0.00', 'ImpTrib' => '0.00', 'ImpIVA' => '0.00', 'MonId' => 'PES', 'MonCotiz' => '1', 'CondicionIVAReceptorId' => $buyer['vatCondition']];
        if ($type === 11) {
            $payload['ImpNeto'] = Money::round($total);

            return $payload;
        }
        $groups = [];
        foreach ($lines as $line) {
            $rate = $line['vatRate'];
            $groups[$rate] = ($groups[$rate] ?? Money::of('0'))->plus($line['total']);
        }
        $iva = [];
        $ids = ['0' => 3, '10.5' => 4, '21' => 5, '27' => 6, '5' => 8, '2.5' => 9];
        foreach ($groups as $rate => $gross) {
            if ($rate === 'exento' || $rate === 'no_gravado') {
                $key = $rate === 'exento' ? 'ImpOpEx' : 'ImpTotConc';
                $payload[$key] = Money::round($gross);

                continue;
            }
            if (! isset($ids[$rate])) {
                throw AppError::badRequest('FISCAL_VAT', 'Una alícuota de la venta no es compatible con la facturación');
            }
            $factor = Money::of((string) $rate)->dividedBy('100', 4)->plus('1');
            $base = $gross->dividedBy($factor, 2, RoundingMode::HALF_UP);
            $tax = $gross->minus($base);
            $payload['ImpNeto'] = Money::round(Money::of($payload['ImpNeto'])->plus($base));
            $payload['ImpIVA'] = Money::round(Money::of($payload['ImpIVA'])->plus($tax));
            $iva[] = ['Id' => $ids[$rate], 'BaseImp' => Money::round($base), 'Importe' => Money::round($tax)];
        }
        if (! Money::of($payload['ImpNeto'])->plus($payload['ImpIVA'])->plus($payload['ImpOpEx'])->plus($payload['ImpTotConc'])->isEqualTo($total)) {
            throw AppError::badRequest('FISCAL_TOTAL', 'Los totales fiscales no coinciden con la venta');
        }
        if ($iva) {
            $payload['Iva'] = $iva;
        }

        return $payload;
    }

    public static function xml(array $payload): string
    {
        $xml = '';
        foreach ($payload as $key => $value) {
            if ($key === 'Iva') {
                $xml .= '<Iva>';
                foreach ($value as $row) {
                    $xml .= '<AlicIva>'.self::xml($row).'</AlicIva>';
                }
                $xml .= '</Iva>';
            } else {
                $xml .= '<'.$key.'>'.ArcaClient::escape((string) $value).'</'.$key.'>';
            }
        }

        return $xml;
    }
}
