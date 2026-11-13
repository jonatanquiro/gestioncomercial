<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
| La web (React compilado en public/spa) maneja sus propias rutas: /login, /registro, /app...
| Cualquier GET que no sea de la API ni un archivo existente devuelve su index.html.
*/
Route::get('/{path?}', function (Request $request) {
    $index = public_path('spa/index.html');
    if (! is_file($index)) {
        return response('Falta compilar la web: corré "pnpm build" en la raíz del repositorio.', 503)
            ->header('Content-Type', 'text/plain; charset=UTF-8');
    }

    $base = htmlspecialchars($request->getBaseUrl(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $html = file_get_contents($index);
    $html = str_replace(['src="./', 'href="./'], ['src="'.$base.'/spa/', 'href="'.$base.'/spa/'], $html);
    $html = str_replace('<head>', '<head><meta name="app-base-path" content="'.$base.'">', $html);

    return response($html, 200, ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'no-cache']);
})->where('path', '^(?!api(/|$)|spa/).*$');
