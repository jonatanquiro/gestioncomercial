<?php

namespace App\Services;

use App\Models\ReferenceProduct;
use RuntimeException;
use ZipArchive;

/**
 * Lee los archivos de SEPA (Precios Claros, datos abiertos de la Secretaría de Comercio) y llena
 * el catálogo de referencia con código, nombre, marca y presentación. No guarda precios.
 *
 * Acepta el ZIP del día tal como se descarga (trae un ZIP por cadena, cada uno con su
 * productos.csv), una carpeta ya descomprimida o un productos.csv suelto. Los CSV van separados
 * por "|" y terminan con una línea "Última actualización: …", que se ignora.
 */
class SepaImporter
{
    private const REQUIRED = ['id_producto', 'productos_ean', 'productos_descripcion', 'productos_marca'];

    /** Unidades de SEPA → como se escriben en la etiqueta. */
    private const UNITS = [
        'gr' => 'g', 'grs' => 'g', 'g' => 'g', 'kg' => 'kg', 'kgs' => 'kg', 'mg' => 'mg',
        'lt' => 'l', 'lts' => 'l', 'l' => 'l', 'ml' => 'ml', 'cc' => 'cc', 'cm3' => 'cc',
        'un' => 'un', 'u' => 'un', 'uni' => 'un', 'unid' => 'un', 'mt' => 'm', 'mts' => 'm', 'm' => 'm', 'cm' => 'cm',
    ];

    /** @var array<string, array{n: int, name: string, brand: ?string, presentation: ?string}> */
    private array $found = [];

    private int $files = 0;

    private int $rows = 0;

    /** @return array{files: int, rows: int, products: int} */
    public function import(string $path): array
    {
        $this->found = [];
        $this->files = 0;
        $this->rows = 0;

        if (is_dir($path)) {
            $this->readDirectory($path);
        } elseif (is_file($path) && str_ends_with(strtolower($path), '.zip')) {
            $this->readZip($path);
        } elseif (is_file($path)) {
            $this->readFile($path);
        } else {
            throw new RuntimeException("No existe {$path}");
        }
        if ($this->files === 0) {
            throw new RuntimeException('No se encontró ningún productos.csv de SEPA en '.$path);
        }

        $now = now()->format('Y-m-d H:i:s.u');
        foreach (array_chunk($this->found, 500, true) as $chunk) {
            $rows = [];
            foreach ($chunk as $code => $p) {
                $rows[] = [
                    'code' => (string) $code, 'name' => self::calm($p['name']), 'brand' => self::calm($p['brand']), 'presentation' => $p['presentation'],
                    'source' => 'sepa', 'seen_in' => $p['n'], 'updated_at' => $now,
                ];
            }
            ReferenceProduct::upsert($rows, ['code'], ['name', 'brand', 'presentation', 'source', 'seen_in', 'updated_at']);
        }

        return ['files' => $this->files, 'rows' => $this->rows, 'products' => count($this->found)];
    }

    private function readDirectory(string $dir): void
    {
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
        $paths = [];
        foreach ($it as $file) {
            $paths[] = $file->getPathname();
        }
        sort($paths);
        foreach ($paths as $p) {
            $name = strtolower(basename($p));
            if ($name === 'productos.csv') {
                $this->readFile($p);
            } elseif (str_ends_with($name, '.zip')) {
                $this->readZip($p);
            }
        }
    }

    private function readFile(string $path): void
    {
        $handle = fopen($path, 'r') ?: throw new RuntimeException("No se pudo abrir {$path}");
        try {
            $this->readCsv($handle, $path);
        } finally {
            fclose($handle);
        }
    }

    /** Los ZIP de cada cadena vienen dentro del ZIP del día: se extraen de a uno a un archivo temporal. */
    private function readZip(string $path): void
    {
        if (! class_exists(ZipArchive::class)) {
            throw new RuntimeException('PHP no tiene la extensión zip activada. En XAMPP, activá extension=zip en php.ini o descomprimí el archivo y pasá la carpeta.');
        }
        $zip = new ZipArchive;
        if ($zip->open($path) !== true) {
            throw new RuntimeException("No se pudo abrir {$path} como ZIP");
        }
        try {
            $names = [];
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $names[] = (string) $zip->getNameIndex($i);
            }
            sort($names);
            foreach ($names as $name) {
                $base = strtolower(basename($name));
                if ($base === 'productos.csv') {
                    $stream = $zip->getStream($name) ?: throw new RuntimeException("No se pudo leer {$name}");
                    try {
                        $this->readCsv($stream, $name);
                    } finally {
                        fclose($stream);
                    }
                } elseif (str_ends_with($base, '.zip')) {
                    $tmp = tempnam(sys_get_temp_dir(), 'sepa');
                    $in = $zip->getStream($name) ?: throw new RuntimeException("No se pudo leer {$name}");
                    $out = fopen($tmp, 'w');
                    stream_copy_to_stream($in, $out);
                    fclose($in);
                    fclose($out);
                    try {
                        $this->readZip($tmp);
                    } finally {
                        @unlink($tmp);
                    }
                }
            }
        } finally {
            $zip->close();
        }
    }

    /** @param  resource  $handle */
    private function readCsv($handle, string $label): void
    {
        $header = fgets($handle);
        if ($header === false) {
            return;
        }
        $columns = array_map(fn ($c) => strtolower(trim($c)), explode('|', preg_replace('/^\xEF\xBB\xBF/', '', $header)));
        $idx = array_flip($columns);
        foreach (self::REQUIRED as $col) {
            if (! isset($idx[$col])) {
                throw new RuntimeException("{$label} no tiene la columna {$col}: no parece un productos.csv de SEPA");
            }
        }
        $this->files++;
        $count = count($columns);
        $seen = [];

        while (($line = fgets($handle)) !== false) {
            $f = explode('|', rtrim($line, "\r\n"));
            // La última línea ("Última actualización: …") y las filas rotas no tienen todas las columnas.
            if (count($f) !== $count) {
                continue;
            }
            $this->rows++;
            if (trim($f[$idx['productos_ean']]) !== '1') {
                continue; // Código interno de la cadena, no un código de barras.
            }
            $code = ReferenceProduct::key($f[$idx['id_producto']]);
            $name = self::clean($f[$idx['productos_descripcion']], 160);
            if ($code === null || $name === null || isset($seen[$code])) {
                continue;
            }
            $seen[$code] = true;
            $candidate = [
                'name' => $name,
                'brand' => self::clean($f[$idx['productos_marca']], 80),
                'presentation' => self::presentation(
                    isset($idx['productos_cantidad_presentacion']) ? $f[$idx['productos_cantidad_presentacion']] : '',
                    isset($idx['productos_unidad_medida_presentacion']) ? $f[$idx['productos_unidad_medida_presentacion']] : '',
                ),
            ];
            $current = $this->found[$code] ?? null;
            if ($current === null) {
                $this->found[$code] = ['n' => 1] + $candidate;

                continue;
            }
            $this->found[$code]['n']++;
            // Se queda la primera descripción, salvo que esté toda en mayúsculas y la nueva no.
            if (self::shouting($current['name']) && ! self::shouting($name)) {
                $this->found[$code] = ['n' => $this->found[$code]['n']] + $candidate;
            }
        }
    }

    private static function clean(string $value, int $max): ?string
    {
        $value = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
        if ($value === '' || $value === '-' || strtoupper($value) === 'SIN MARCA') {
            return null;
        }

        return mb_substr($value, 0, $max);
    }

    /** "YERBA MATE SUAVE" → "Yerba Mate Suave". Lo que ya viene en minúsculas no se toca. */
    private static function calm(?string $value): ?string
    {
        return $value !== null && self::shouting($value) ? mb_convert_case(mb_strtolower($value), MB_CASE_TITLE) : $value;
    }

    private static function shouting(string $value): bool
    {
        return preg_match('/\p{L}/u', $value) === 1 && mb_strtoupper($value) === $value;
    }

    /** "500.00" + "GR" → "500 g"; "2.25" + "lt" → "2,25 l". */
    private static function presentation(string $quantity, string $unit): ?string
    {
        $quantity = trim(str_replace(',', '.', $quantity));
        $unit = self::UNITS[strtolower(trim($unit, " .\t"))] ?? null;
        if ($unit === null || ! preg_match('/^\d{1,7}(\.\d+)?$/', $quantity)) {
            return null;
        }
        if (str_contains($quantity, '.')) {
            $quantity = rtrim(rtrim($quantity, '0'), '.');
        }
        $quantity = ltrim($quantity, '0');
        if ($quantity === '') {
            return null;
        }
        if (str_starts_with($quantity, '.')) {
            $quantity = '0'.$quantity;
        }

        return str_replace('.', ',', $quantity).' '.$unit;
    }
}
