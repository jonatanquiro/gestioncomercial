<?php

namespace App\Console\Commands;

use App\Models\PlatformUser;
use App\Services\PasswordService;
use App\Support\AppError;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use PragmaRX\Google2FA\Google2FA;

/**
 * Alta de un operador del panel de plataforma. La contraseña se lee de PLATFORM_ADMIN_PASSWORD
 * (o se pide por consola) para que no quede en el historial. Imprime el secreto TOTP una sola vez.
 */
class CreatePlatformAdmin extends Command
{
    protected $signature = 'platform:create-admin {email} {name}';

    protected $description = 'Crea un operador del panel de plataforma con TOTP';

    public function handle(PasswordService $passwords): int
    {
        $email = mb_strtolower(trim((string) $this->argument('email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('Email inválido');

            return self::FAILURE;
        }
        if (PlatformUser::where('email', $email)->exists()) {
            $this->error('Ya existe un operador con ese email');

            return self::FAILURE;
        }
        $password = (string) (env('PLATFORM_ADMIN_PASSWORD') ?: $this->secret('Contraseña (mínimo 10 caracteres)'));
        if (mb_strlen($password) < 10) {
            $this->error('La contraseña debe tener al menos 10 caracteres');

            return self::FAILURE;
        }
        try {
            $hash = $passwords->hash($password);
        } catch (AppError $e) {
            $this->error($e->details[0]['message'] ?? $e->getMessage());

            return self::FAILURE;
        }
        $google2fa = new Google2FA;
        $secret = $google2fa->generateSecretKey(32);
        PlatformUser::create([
            'email' => $email,
            'name' => trim((string) $this->argument('name')),
            'password_hash' => $hash,
            'totp_secret_enc' => Crypt::encryptString($secret),
        ]);

        $this->info("Operador creado: {$email}");
        $this->line('Cargá este secreto en tu app de autenticación (se muestra una sola vez):');
        $this->line("  Clave manual: {$secret}");
        $this->line('  URI: '.$google2fa->getQRCodeUrl('Gestión Comercial', $email, $secret));

        return self::SUCCESS;
    }
}
