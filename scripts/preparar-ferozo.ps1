param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$salida = Join-Path $repo ('dist/ferozo-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$privado = Join-Path $salida 'gestion-comercial-servidor'
$publico = Join-Path $salida 'gestion-comercial'

New-Item -ItemType Directory -Path $privado, $publico | Out-Null
foreach ($carpeta in @('app', 'config', 'database', 'resources', 'routes', 'vendor')) {
    Copy-Item -LiteralPath (Join-Path $repo "apps/server/$carpeta") -Destination $privado -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $privado 'bootstrap/cache') | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'apps/server/bootstrap/app.php') -Destination (Join-Path $privado 'bootstrap')
Copy-Item -LiteralPath (Join-Path $repo 'apps/server/bootstrap/providers.php') -Destination (Join-Path $privado 'bootstrap')
foreach ($carpeta in @('storage/app/private', 'storage/app/public', 'storage/framework/cache/data', 'storage/framework/sessions', 'storage/framework/views', 'storage/logs')) {
    New-Item -ItemType Directory -Path (Join-Path $privado $carpeta) -Force | Out-Null
}
foreach ($archivo in @('artisan', 'composer.json', 'composer.lock')) {
    Copy-Item -LiteralPath (Join-Path $repo "apps/server/$archivo") -Destination $privado
}

# La instalación local queda intacta. Se quitan las dependencias de desarrollo solo de la copia.
Push-Location $privado
# Composer y PHP escriben avisos normales por stderr: en Windows PowerShell 5.1, con 'Stop', eso corta
# el script. Acá decide solo el código de salida.
$ErrorActionPreference = 'Continue'
try {
    & composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction --no-scripts
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar las dependencias PHP.' }
    & php artisan package:discover --ansi
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar Laravel.' }
} finally { Pop-Location; $ErrorActionPreference = 'Stop' }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$plantilla = [IO.File]::ReadAllText((Join-Path $repo 'apps/server/.env.example'))
$plantilla = $plantilla.Replace('APP_ENV=local', 'APP_ENV=production').Replace('APP_DEBUG=true', 'APP_DEBUG=false')
$plantilla = $plantilla.Replace('APP_URL=http://localhost:8000', 'APP_URL=https://celenial.com.ar/gestion-comercial')
$plantilla = $plantilla.Replace('SESSION_SECURE_COOKIE=false', 'SESSION_SECURE_COOKIE=true').Replace('SESSION_PATH=/', 'SESSION_PATH=/gestion-comercial')
$plantilla = $plantilla.Replace('DB_DATABASE=gestioncomercial', 'DB_DATABASE=COMPLETAR_BASE_FEROZO').Replace('DB_USERNAME=root', 'DB_USERNAME=COMPLETAR_USUARIO_FEROZO').Replace('DB_PASSWORD=', 'DB_PASSWORD=COMPLETAR_CLAVE_FEROZO')
$plantilla = $plantilla.Replace('MAIL_MAILER=log', 'MAIL_MAILER=smtp').Replace('MAIL_SCHEME=', 'MAIL_SCHEME=smtps').Replace('MAIL_HOST=127.0.0.1', 'MAIL_HOST=COMPLETAR_SERVIDOR_SMTP_FEROZO').Replace('MAIL_PORT=1025', 'MAIL_PORT=465')
$plantilla = $plantilla.Replace('MAIL_USERNAME=null', 'MAIL_USERNAME=hola@celenial.com.ar').Replace('MAIL_PASSWORD=null', 'MAIL_PASSWORD=COMPLETAR_CLAVE_CASILLA')
[IO.File]::WriteAllText((Join-Path $privado '.env.example'), $plantilla, $utf8)

Get-ChildItem -LiteralPath (Join-Path $repo 'apps/server/public') -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $publico -Recurse
}
$entrada = @'
<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Estructura: /cuenta/gestion-comercial-servidor y /cuenta/public_html/gestion-comercial.
// Si la raiz publica de tu cuenta tiene otra estructura, ajustar esta ruta absoluta.
$server = dirname(__DIR__, 2).'/gestion-comercial-servidor';

if (file_exists($maintenance = $server.'/storage/framework/maintenance.php')) {
    require $maintenance;
}
require $server.'/vendor/autoload.php';
$app = require_once $server.'/bootstrap/app.php';
$app->usePublicPath(__DIR__);
$app->handleRequest(Request::capture());
'@
[IO.File]::WriteAllText((Join-Path $publico 'index.php'), $entrada, $utf8)

& (Join-Path $PSScriptRoot 'comprimir-ferozo.ps1') -CarpetaPaquete $salida
Copy-Item -LiteralPath (Join-Path $repo 'docs/despliegue-ferozo.md') -Destination $salida
Write-Host "Paquetes preparados en: $salida"
Write-Host 'No incluyen la base de datos, el .env local ni los certificados sueltos.'
