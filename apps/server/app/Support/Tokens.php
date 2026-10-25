<?php

namespace App\Support;

/** Tokens aleatorios para cookies y enlaces. Se guardan hasheados: una fuga de la base no permite usarlos. */
class Tokens
{
    public static function random(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
