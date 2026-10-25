<?php

namespace App\Services;

use App\Support\AppError;

/** Argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, t=2, p=1). */
class PasswordService
{
    private const OPTIONS = ['memory_cost' => 19456, 'time_cost' => 2, 'threads' => 1];

    /** Contraseñas muy comunes de 10 o más caracteres. Lista local mínima, reemplazable por un servicio de contraseñas filtradas. */
    private const COMMON = [
        '1234567890', '0987654321', '1q2w3e4r5t', 'qwertyuiop', 'asdfghjkl1', 'password12', 'password123',
        'password1234', 'contraseña', 'contrasena', 'contraseña1', 'contrasena1', 'contraseña123', 'contrasena123',
        'iloveyou12', 'qwerty1234', 'qwerty12345', 'abc1234567', 'abcdefghij', 'administrador', 'admin12345',
        'admin123456', 'bocajuniors', 'riverplate', 'argentina1', 'argentina10', 'argentina123', 'messi10messi',
        'qazwsxedcr', '1qaz2wsx3edc', 'zxcvbnm123', 'welcome123', 'superman12', 'football12', 'princesa12',
        'kiosco1234', 'almacen123', 'comercio123', 'teamoteamo', 'sanlorenzo', 'racingclub', 'independiente',
    ];

    private ?string $dummyHash = null;

    public function hash(string $password): string
    {
        $this->assertStrong($password);

        return $this->algorithm() === PASSWORD_BCRYPT
            ? password_hash($password, PASSWORD_BCRYPT, ['cost' => 12])
            : password_hash($password, PASSWORD_ARGON2ID, self::OPTIONS);
    }

    /** Con $hash null verifica contra un hash ficticio para que el tiempo de respuesta no revele si el usuario existe. */
    public function verify(?string $hash, string $password): bool
    {
        if ($hash === null) {
            $this->dummyHash ??= password_hash('contraseña-inexistente-para-tiempos', $this->algorithm(), $this->algorithm() === PASSWORD_BCRYPT ? ['cost' => 12] : self::OPTIONS);
            password_verify($password, $this->dummyHash);

            return false;
        }

        return password_verify($password, $hash);
    }

    public function assertStrong(string $password): void
    {
        $normalized = mb_strtolower($password);
        if (in_array($normalized, self::COMMON, true) || preg_match('/^(.)\1+$/u', $password) || preg_match('/^\d+$/', $password)) {
            throw AppError::validation([['path' => 'password', 'message' => 'La contraseña es demasiado común. Elegí otra.']]);
        }
    }

    /** Argon2id si el PHP lo trae (XAMPP lo incluye); si no, bcrypt. password_verify acepta ambos. */
    private function algorithm(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }
}
