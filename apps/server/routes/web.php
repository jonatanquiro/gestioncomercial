<?php

use Illuminate\Support\Facades\Route;

/*
| La web (React compilado en public/spa) maneja sus propias rutas: /login, /registro, /app...
| Cualquier GET que no sea de la API ni un archivo existente devuelve su index.html.
*/
Route::get('/{path?}', function () {
    $index = public_path('spa/index.html');
    if (! is_file($index)) {
        return response('Falta compilar la web: corré "pnpm build" en la raíz del repositorio.', 503)
            ->header('Content-Type', 'text/plain; charset=UTF-8');
    }

    return response()->file($index, ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'no-cache']);
})->where('path', '^(?!api(/|$)|spa/).*$');
