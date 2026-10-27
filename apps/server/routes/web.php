<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
| La web (React compilado en public/spa) maneja sus propias rutas: /login, /registro, /app...
| Cualquier GET que no sea de la API ni un archivo existente devuelve su index.html.
|
| index.html sale compilado con rutas relativas (./assets/...). Acá se completan con la ruta base
| del sitio, para que funcione igual en la raíz (http://localhost:8000) y en una subcarpeta
| (https://celenial.com.ar/gestion-comercial). Ver docs/adr/0009.
*/
Route::get('/{path?}', function (Request $request) {
    $index = public_path('spa/index.html');
    if (! is_file($index)) {
        return response('Falta compilar la web: corré "pnpm build" en la raíz del repositorio.', 503)
            ->header('Content-Type', 'text/plain; charset=UTF-8');
    }

    $base = htmlspecialchars(rtrim($request->getBasePath(), '/'), ENT_QUOTES, 'UTF-8');
    $html = str_replace(
        ['<meta name="gc-base" content="" />', '="./'],
        ['<meta name="gc-base" content="'.$base.'" />', '="'.$base.'/spa/'],
        (string) file_get_contents($index),
    );

    return response($html, 200, ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'no-cache']);
})->where('path', '^(?!api(/|$)|spa/).*$');
