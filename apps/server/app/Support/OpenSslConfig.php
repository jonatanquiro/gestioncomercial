<?php

namespace App\Support;

class OpenSslConfig
{
    /** Configuración de pedidos independiente de la instalación; la semilla nunca se escribe en public/. */
    public static function options(): array
    {
        $directory = storage_path('app/private');
        if (! is_dir($directory)) {
            mkdir($directory, 0700, true);
        }
        $path = $directory.'/openssl-request.cnf';
        $seed = str_replace('\\', '/', $directory.'/.openssl-random');
        $content = 'RANDFILE = "'.$seed.'"'."\n[req]\ndefault_bits = 2048\ndefault_md = sha256\ndistinguished_name = dn\nprompt = no\n[dn]\n";
        if (! is_file($path) || file_get_contents($path) !== $content) {
            file_put_contents($path, $content, LOCK_EX);
        }

        return ['config' => $path];
    }
}
