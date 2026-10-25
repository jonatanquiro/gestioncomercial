<?php

namespace App\Support;

use Illuminate\Support\Facades\Validator;

/**
 * Validación con mensajes en español y el mismo formato de error que espera la web:
 * VALIDATION_ERROR con details = [{ path, message }]. Los textos ya llegan recortados y
 * con "" convertido a null (middlewares globales TrimStrings y ConvertEmptyStringsToNull).
 */
class Input
{
    private const MESSAGES = [
        'required' => 'Obligatorio',
        'present' => 'Obligatorio',
        'string' => 'Debe ser un texto',
        'email' => 'Email inválido',
        'max.string' => 'Máximo :max caracteres',
        'max.array' => 'Máximo :max elementos',
        'max.numeric' => 'Máximo :max',
        'min.string' => 'Mínimo :min caracteres',
        'min.array' => 'Elegí al menos :min',
        'min.numeric' => 'Mínimo :min',
        'uuid' => 'Identificador inválido',
        'in' => 'Valor inválido',
        'boolean' => 'Debe ser verdadero o falso',
        'integer' => 'Debe ser un número entero',
        'array' => 'Formato inválido',
        'regex' => 'Formato inválido',
        'distinct' => 'Hay valores repetidos',
    ];

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>  $rules
     * @param  array<string, string>  $messages  mensajes propios por campo.regla
     * @return array<string, mixed> solo los campos validados
     */
    public static function validate(array $data, array $rules, array $messages = []): array
    {
        $validator = Validator::make($data, $rules, $messages + self::MESSAGES);
        if ($validator->fails()) {
            $details = [];
            foreach ($validator->errors()->messages() as $path => $list) {
                $details[] = ['path' => $path, 'message' => $list[0]];
            }
            throw AppError::validation($details);
        }

        return $validator->validated();
    }

    /** Email normalizado como en packages/contracts: recortado y en minúsculas. */
    public static function email(mixed $value): mixed
    {
        return is_string($value) ? mb_strtolower(trim($value)) : $value;
    }

    /** Regla de contraseña nueva (mismos límites que passwordSchema). */
    public static function passwordRules(): array
    {
        return ['required', 'string', 'min:10', 'max:128'];
    }

    public static function passwordMessages(string $field): array
    {
        return [
            "{$field}.min" => 'La contraseña debe tener al menos 10 caracteres',
            "{$field}.max" => 'La contraseña no puede superar 128 caracteres',
        ];
    }

    /** Regla de CUIT opcional: normaliza y verifica el dígito. */
    public static function cuitRule(): \Closure
    {
        return function (string $attribute, mixed $value, \Closure $fail) {
            if ($value !== null && (! is_string($value) || ! Cuit::isValid($value))) {
                $fail('CUIT inválido');
            }
        };
    }

    public static function optionalCuit(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? Cuit::normalize($value) : null;
    }

    /** Booleano JSON estricto (true/false), como z.boolean(). */
    public static function strictBoolean(): \Closure
    {
        return function (string $attribute, mixed $value, \Closure $fail) {
            if (! is_bool($value)) {
                $fail('Debe ser verdadero o falso');
            }
        };
    }

    /** Número entero de una lista cerrada (como z.union de z.literal). @param list<int> $allowed */
    public static function oneOfIntegers(array $allowed): \Closure
    {
        return function (string $attribute, mixed $value, \Closure $fail) use ($allowed) {
            if (! is_int($value) || ! in_array($value, $allowed, true)) {
                $fail('Valor inválido');
            }
        };
    }
}
