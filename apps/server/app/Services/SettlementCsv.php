<?php

namespace App\Services;

use App\Support\AppError;
use App\Support\Money;

/** Importación explícita: no supone que todos los proveedores exportan las mismas columnas. */
class SettlementCsv
{
    public function parse(string $csv, string $delimiter, string $decimal, array $columns): array
    {
        if (! mb_check_encoding($csv, 'UTF-8')) {
            $csv = mb_convert_encoding($csv, 'UTF-8', 'Windows-1252');
        }
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, preg_replace('/^\xEF\xBB\xBF/', '', $csv));
        rewind($stream);
        $headers = fgetcsv($stream, 0, $delimiter, '"', '');
        if (! $headers) {
            throw AppError::validation([['path' => 'csv', 'message' => 'El archivo está vacío']]);
        }
        foreach (['reference', 'gross', 'fees', 'net', 'date'] as $key) {
            if (isset($columns[$key]) && ! array_key_exists($columns[$key], $headers)) {
                throw AppError::validation([['path' => "columns.{$key}", 'message' => 'Columna inexistente']]);
            }
        }
        $rows = [];
        $seen = [];
        try {
            while (($line = fgetcsv($stream, 0, $delimiter, '"', '')) !== false) {
                if (count($line) === 1 && trim($line[0] ?? '') === '') {
                    continue;
                }
                $n = count($rows) + 2;
                if ($n > 2001) {
                    throw AppError::badRequest('CSV_LIMIT', 'Importá hasta 2000 movimientos por archivo');
                }
                $ref = trim((string) ($line[$columns['reference']] ?? ''));
                if ($ref === '' || mb_strlen($ref) > 100 || isset($seen[$ref])) {
                    throw AppError::validation([['path' => 'csv', 'message' => "Fila {$n}: identificador vacío, repetido o demasiado largo"]]);
                }
                $seen[$ref] = true;
                $amount = function (string $key) use ($columns, $line, $decimal, $n) {
                    if (! isset($columns[$key])) {
                        return null;
                    }
                    $raw = trim((string) ($line[$columns[$key]] ?? ''));
                    $raw = str_replace(['$', ' ', "\xc2\xa0"], '', $raw);
                    $format = $decimal === ',' ? '/^(?:\d{1,12}|\d{1,3}(?:\.\d{3}){1,3})(?:,\d{1,2})?$/' : '/^(?:\d{1,12}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{1,2})?$/';
                    if (! preg_match($format, $raw)) {
                        throw AppError::validation([['path' => 'csv', 'message' => "Fila {$n}: revisá los separadores de miles y decimales en {$key}"]]);
                    }
                    $raw = $decimal === ',' ? str_replace(',', '.', str_replace('.', '', $raw)) : str_replace(',', '', $raw);
                    if (! preg_match('/^\d{1,12}(\.\d{1,2})?$/', $raw)) {
                        throw AppError::validation([['path' => 'csv', 'message' => "Fila {$n}: importe inválido en {$key}. Importá únicamente cobros positivos en ARS; separá devoluciones y otros movimientos."]]);
                    }

                    return Money::round($raw);
                };
                $gross = $amount('gross');
                $fees = $amount('fees');
                $net = $amount('net');
                if ($net === null && $fees === null) {
                    throw AppError::validation([['path' => 'columns', 'message' => 'Seleccioná la columna de comisiones/deducciones o la de neto']]);
                }
                $fees ??= Money::round(Money::of($gross)->minus($net));
                $net ??= Money::round(Money::of($gross)->minus($fees));
                if (Money::of($fees)->isNegative() || Money::of($net)->isNegative() || ! Money::of($gross)->minus($fees)->isEqualTo($net)) {
                    throw AppError::validation([['path' => 'csv', 'message' => "Fila {$n}: el bruto menos las deducciones debe coincidir con el neto"]]);
                }
                $date = isset($columns['date']) ? trim((string) ($line[$columns['date']] ?? '')) : null;
                if ($date !== null && $date !== '' && (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || ! checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4)))) {
                    throw AppError::validation([['path' => 'csv', 'message' => "Fila {$n}: usá fecha de acreditación AAAA-MM-DD"]]);
                }
                $rows[] = ['external_id' => $ref, 'gross' => $gross, 'fees' => $fees, 'net' => $net, 'credited_on' => $date ?: null];
            }
        } finally {
            fclose($stream);
        }
        if ($rows === []) {
            throw AppError::validation([['path' => 'csv', 'message' => 'El archivo no tiene movimientos']]);
        }

        return $rows;
    }
}
