<?php

namespace App\Console\Commands;

use App\Models\PlatformUser;
use App\Services\PasswordService;
use App\Support\AppError;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Alta de un operador del panel de plataforma. La contraseña se lee de PLATFORM_ADMIN_PASSWORD
 * (o se pide por consola) para que no quede en el historial. Con --sql=archivo no toca la base:
 * escribe el INSERT para importarlo en un hosting sin consola (phpMyAdmin).
 */
class CreatePlatformAdmin extends Command
{
    protected $signature = 'platform:create-admin {email} {name} {--sql= : Escribe el INSERT en este archivo en lugar de crear el operador}';

    protected $description = 'Crea un operador del panel de plataforma';

    public function handle(PasswordService $passwords): int
    {
        $email = mb_strtolower(trim((string) $this->argument('email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('Email inválido');

            return self::FAILURE;
        }
        $sql = $this->option('sql');
        if (! $sql && PlatformUser::where('email', $email)->exists()) {
            $this->error('Ya existe un operador con ese email');

            return self::FAILURE;
        }
        $password = (string) (env('PLATFORM_ADMIN_PASSWORD') ?: $this->secret('Contraseña (mínimo 10 caracteres)'));
        if (mb_strlen($password) < 10) {
            $this->error('La contraseña debe tener al menos 10 caracteres');

            return self::FAILURE;
        }
        try {
            $hash = $passwords->hash($password, portable: (bool) $sql);
        } catch (AppError $e) {
            $this->error($e->details[0]['message'] ?? $e->getMessage());

            return self::FAILURE;
        }
        if ($sql) {
            $quote = fn (string $v) => "'".str_replace(['\\', "'"], ['\\\\', "''"], $v)."'";
            $values = [(string) Str::uuid7(), $email, trim((string) $this->argument('name')), $hash, Carbon::now()->utc()->format('Y-m-d H:i:s.u')];
            file_put_contents($sql, "-- Operador del panel de plataforma: {$email}\n"
                .'INSERT INTO `platform_users` (`id`, `email`, `name`, `password_hash`, `created_at`) VALUES ('.implode(', ', array_map($quote, $values)).");\n");
            $this->info("SQL guardado en {$sql}. Importalo en phpMyAdmin y borrá el archivo.");

            return self::SUCCESS;
        }
        PlatformUser::create([
            'email' => $email,
            'name' => trim((string) $this->argument('name')),
            'password_hash' => $hash,
        ]);

        $this->info("Operador creado: {$email}. Entrá en /plataforma/login con ese email y la contraseña.");

        return self::SUCCESS;
    }
}
