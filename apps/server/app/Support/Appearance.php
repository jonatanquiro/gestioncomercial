<?php

namespace App\Support;

class Appearance
{
    public const DEFAULTS = ['logoData' => null, 'primaryColor' => '#b8432a', 'menuColor' => '#1f3b2d', 'font' => 'archivo', 'navigation' => 'side', 'textSize' => 'normal', 'density' => 'normal'];

    public static function validate(array $data): array
    {
        $v = Input::validate($data, [
            'logoData' => ['nullable', 'string', 'max:350000'],
            'primaryColor' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'menuColor' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'font' => ['required', 'in:system,archivo,serif'], 'navigation' => ['required', 'in:side,top'],
            'textSize' => ['required', 'in:normal,large'], 'density' => ['required', 'in:normal,compact'],
        ]);
        $rgb = sscanf($v['primaryColor'], '#%02x%02x%02x');
        $luminance = 0;
        foreach ($rgb as $i => $c) {
            $channel = $c / 255;
            $luminance += ($channel <= 0.04045 ? $channel / 12.92 : (($channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][$i];
        }
        if (1.05 / ($luminance + 0.05) < 4.5) {
            throw AppError::validation([['path' => 'primaryColor', 'message' => 'Elegí un color principal más oscuro para que los botones se lean bien']]);
        }
        if (! empty($v['logoData'])) {
            if (! preg_match('~^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$~', $v['logoData'], $m)) {
                throw AppError::validation([['path' => 'logoData', 'message' => 'Usá un logo PNG, JPEG o WebP']]);
            }
            $bytes = base64_decode($m[2], true);
            $info = $bytes === false ? false : @getimagesizefromstring($bytes);
            if (! $info || strlen($bytes) > 250000 || $info[0] > 2000 || $info[1] > 2000 || ($info['mime'] ?? '') !== 'image/'.$m[1]) {
                throw AppError::validation([['path' => 'logoData', 'message' => 'Logo inválido: máximo 250 KB y 2000 × 2000 píxeles']]);
            }
        }
        $v['logoData'] = $v['logoData'] ?? null;

        return $v;
    }
}
