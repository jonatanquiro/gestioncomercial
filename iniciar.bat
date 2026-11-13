@echo off
setlocal EnableExtensions
title Gestion Comercial
rem ------------------------------------------------------------------
rem  Actualiza el sistema y lo deja andando en http://localhost:8000
rem
rem  1. Baja la ultima version del codigo desde GitHub (o lo clona la primera vez).
rem  2. Instala las dependencias de PHP con Composer.
rem  3. Actualiza la base de datos (php artisan migrate).
rem  4. Levanta el servidor y abre el navegador.
rem
rem  Antes de correrlo: iniciar MySQL desde el panel de XAMPP.
rem  Va dentro de la carpeta del sistema (al lado de README.md), aunque se haya instalado
rem  desde un ZIP. Tambien sirve en la carpeta que la contiene (por ejemplo C:\xampp\htdocs).
rem  Ojo: descarta cambios hechos a mano en el codigo. El archivo .env (con la configuracion
rem  de la base: usuario, contrasena, puerto) no se toca nunca.
rem ------------------------------------------------------------------

set "REPO_URL=https://github.com/jonatanquiro/gestioncomercial.git"
rem Rama con la version mas nueva para probar (cambia cuando se aprueban los PR).
set "BRANCH=claude/project-thread-fsg3x5"
set "PORT=8000"

rem --- Carpeta del sistema: la de este archivo, una subcarpeta gestioncomercial* (por ejemplo
rem     la que deja el ZIP de GitHub) o, si no hay ninguna, se clona en .\gestioncomercial
set "ROOT="
if exist "%~dp0apps\server\artisan" set "ROOT=%~dp0"
if not defined ROOT for /d %%D in ("%~dp0gestioncomercial*") do (
    if not defined ROOT if exist "%%~fD\apps\server\artisan" set "ROOT=%%~fD\"
)
if not defined ROOT set "ROOT=%~dp0gestioncomercial\"

rem --- Programas necesarios
where git >nul 2>nul || (
    echo [X] No encuentro Git. Instalalo desde https://git-scm.com/download/win y volve a correr este archivo.
    goto :fin
)
set "PHP=php"
if exist "C:\xampp\php\php.exe" set "PHP=C:\xampp\php\php.exe"
"%PHP%" -v >nul 2>nul || (
    echo [X] No encuentro PHP. Instala XAMPP 8.2 en C:\xampp.
    goto :fin
)
where composer >nul 2>nul || (
    echo [X] No encuentro Composer. Instalalo desde https://getcomposer.org/Composer-Setup.exe y volve a correr este archivo.
    goto :fin
)

rem --- 1. Codigo
if not exist "%ROOT%apps\server\artisan" (
    echo == Descargando el sistema por primera vez en %ROOT%
    git clone "%REPO_URL%" "%ROOT%" || goto :error
)
cd /d "%ROOT%" || goto :error
if not exist ".git" (
    rem Instalado desde un ZIP: se conecta la carpeta con GitHub sin moverla.
    echo == Conectando la carpeta con GitHub
    git init -q || goto :error
    git remote add origin "%REPO_URL%" || goto :error
)
echo == Bajando la ultima version (%BRANCH%)
git fetch origin "%BRANCH%" || goto :error
git checkout -f -B "%BRANCH%" "origin/%BRANCH%" || goto :error

rem --- 2. Dependencias
cd /d "%ROOT%apps\server" || goto :error
echo == Instalando dependencias de PHP
call composer install --no-interaction --no-progress || goto :error

if not exist ".env" (
    echo == Primera vez: creando el archivo .env
    copy /y ".env.example" ".env" >nul
    "%PHP%" artisan key:generate --force || goto :error
    echo.
    echo [!] Se creo apps\server\.env con usuario root sin contrasena y puerto 3306.
    echo     Si tu MySQL de XAMPP usa otro puerto ^(por ejemplo 3307^) o tiene contrasena,
    echo     cambialo en DB_PORT / DB_PASSWORD de ese archivo y volve a correr este .bat.
    echo.
)

rem --- 3. Base de datos
"%PHP%" artisan config:clear >nul
echo == Actualizando la base de datos
"%PHP%" artisan migrate --force || (
    echo.
    echo [X] No se pudo actualizar la base. Fijate que MySQL este iniciado en el panel de XAMPP
    echo     y que DB_PORT y DB_PASSWORD de apps\server\.env coincidan con los de tu MySQL.
    goto :fin
)

rem --- 4. Servidor
echo.
echo == Listo. El sistema queda en http://localhost:%PORT%
echo    Para apagarlo, cerra esta ventana.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:%PORT%"
"%PHP%" artisan serve --port=%PORT%
goto :fin

:error
echo.
echo [X] Algo fallo en el paso de arriba. Mandame una captura de esta ventana.

:fin
echo.
pause
