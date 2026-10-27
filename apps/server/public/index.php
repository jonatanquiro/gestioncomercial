<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Dónde está el resto del sistema. Normalmente, la carpeta de arriba (apps/server).
// En un hosting compartido el contenido de public/ va a la carpeta pública (por ejemplo
// public_html/gestion-comercial) y el sistema queda afuera, donde no se puede pedir desde el navegador:
// en ese caso, un archivo sistema.php al lado de este devuelve esa ruta (ver README, "Publicar en un hosting").
$sistema = is_file(__DIR__.'/sistema.php') ? require __DIR__.'/sistema.php' : __DIR__.'/..';

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = $sistema.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require $sistema.'/vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once $sistema.'/bootstrap/app.php';
$app->usePublicPath(__DIR__);

$app->handleRequest(Request::capture());
