<?php

namespace App\Console\Commands;

use App\Services\SepaImporter;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * Llena el catálogo de referencia con los productos de SEPA (Precios Claros). El archivo se
 * descarga a mano de datos.produccion.gob.ar (dataset "Precios Claros - Base SEPA"). Se puede
 * correr de nuevo con un archivo más nuevo: actualiza lo que ya estaba y agrega lo que falta.
 */
class ImportSepaCatalog extends Command
{
    protected $signature = 'catalogo:importar-sepa {ruta : ZIP del día, carpeta descomprimida o productos.csv}';

    protected $description = 'Importa el catálogo de referencia de productos desde los datos abiertos de SEPA';

    public function handle(SepaImporter $importer): int
    {
        $path = (string) $this->argument('ruta');
        $this->info("Leyendo {$path}… (con el archivo completo tarda unos minutos)");
        try {
            $stats = $importer->import($path);
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $this->info(sprintf(
            'Listo: %s productos con código de barras, de %s filas en %d archivos.',
            number_format($stats['products'], 0, ',', '.'), number_format($stats['rows'], 0, ',', '.'), $stats['files'],
        ));

        return self::SUCCESS;
    }
}
