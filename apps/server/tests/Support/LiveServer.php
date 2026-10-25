<?php

namespace Tests\Support;

use RuntimeException;

/**
 * Servidor HTTP real (php -S con varios procesos) contra la base de pruebas, para verificar
 * concurrencia de verdad: pedidos simultáneos en procesos y conexiones distintas.
 */
final class LiveServer
{
    /** @var resource */
    private $process;

    public readonly string $url;

    private string $log;

    public function __construct(int $workers = 6)
    {
        $port = random_int(20000, 40000);
        $this->url = "http://127.0.0.1:{$port}";
        $router = base_path('vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php');
        // Corre como una instalación normal (APP_ENV=local) apuntando a la base de pruebas: con
        // APP_ENV=testing Laravel activa ganchos propios de PHPUnit que no aplican a un servidor.
        $env = array_merge(getenv(), [
            'APP_ENV' => 'local',
            'APP_DEBUG' => 'false',
            'DB_DATABASE' => (string) config('database.connections.mysql.database'),
            'PHP_CLI_SERVER_WORKERS' => (string) $workers,
        ]);
        $this->log = tempnam(sys_get_temp_dir(), 'gc-live-');
        $this->process = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$port}", $router], [1 => ['file', $this->log, 'a'], 2 => ['file', $this->log, 'a']], $pipes, public_path(), $env);
        if (! is_resource($this->process)) {
            throw new RuntimeException('No se pudo iniciar el servidor de prueba');
        }
        for ($i = 0; $i < 100; $i++) {
            $fp = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.1);
            if ($fp) {
                fclose($fp);

                return;
            }
            usleep(100_000);
        }
        $this->stop();
        throw new RuntimeException("El servidor de prueba no respondió:\n".$this->output());
    }

    /** Salida del servidor, para diagnosticar fallas. */
    public function output(): string
    {
        return (string) @file_get_contents($this->log);
    }

    /**
     * Manda todos los pedidos a la vez y devuelve código de estado y cuerpo de cada uno.
     *
     * @param  list<array{method: string, path: string, body: array<string, mixed>}>  $requests
     * @param  array<string, string>  $cookies
     * @return list<array{status: int, body: string}>
     */
    public function parallel(array $requests, array $cookies): array
    {
        $multi = curl_multi_init();
        $handles = [];
        $cookieHeader = implode('; ', array_map(fn ($k, $v) => "{$k}={$v}", array_keys($cookies), $cookies));
        foreach ($requests as $r) {
            $h = curl_init($this->url.'/api/v1'.$r['path']);
            curl_setopt_array($h, [
                CURLOPT_CUSTOMREQUEST => $r['method'],
                CURLOPT_POSTFIELDS => json_encode($r['body']),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_HTTPHEADER => ['content-type: application/json', 'accept: application/json', 'cookie: '.$cookieHeader, 'x-csrf-token: '.($cookies['gc_csrf'] ?? '')],
            ]);
            curl_multi_add_handle($multi, $h);
            $handles[] = $h;
        }
        do {
            $status = curl_multi_exec($multi, $running);
            if ($running) {
                curl_multi_select($multi);
            }
        } while ($running && $status === CURLM_OK);
        $results = [];
        foreach ($handles as $h) {
            $results[] = ['status' => (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE), 'body' => (string) curl_multi_getcontent($h)];
            curl_multi_remove_handle($multi, $h);
        }
        curl_multi_close($multi);

        return $results;
    }

    public function stop(): void
    {
        if (is_resource($this->process)) {
            proc_terminate($this->process);
            proc_close($this->process);
        }
        if (isset($this->log) && is_file($this->log)) {
            @unlink($this->log);
        }
    }

    public function __destruct()
    {
        $this->stop();
    }
}
