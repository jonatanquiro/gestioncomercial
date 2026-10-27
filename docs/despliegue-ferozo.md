# Instalar en celenial.com.ar/gestion-comercial

El proyecto admite la raíz de un dominio y una subcarpeta. Laravel informa el prefijo a la web al entregar el HTML; la misma compilación funciona en ambos casos. No se necesita Node en el hosting.

## 1. Preparar los archivos en tu PC

Desde la raíz del repositorio, compilar la web con `pnpm build` y ejecutar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/preparar-ferozo.ps1
```

Requiere PHP y Composer disponibles en la consola y las dependencias instaladas. Genera una carpeta nueva dentro de `dist` con dos ZIP. No modifica el `.env`, la base ni las dependencias locales. La copia de `vendor` se prepara sin dependencias de desarrollo. No contiene datos ni archivos cargados por usuarios: si en el futuro se guardan adjuntos en `storage/app`, hay que migrarlos por separado.

## 2. Configurar el hosting

En Ferozo, seleccionar PHP 8.2 o superior. Verificar las extensiones requeridas por Laravel y MySQL, incluyendo `pdo_mysql`, `mbstring`, `openssl`, `curl`, `dom`, `xml`, `fileinfo` y `ctype`. La facturación ARCA requiere además `soap`; la importación directa de ZIP requiere `zip`. Si se trasladan usuarios con contraseñas Argon2id, el PHP de destino debe soportar Argon2id para verificarlas.

Crear una base MySQL/MariaDB y un usuario con acceso a ella. Anotar el nombre completo de la base, el usuario, la contraseña y el servidor de MySQL que indique el panel. Habilitar HTTPS en el dominio.

## 3. Subir y descomprimir los dos ZIP

Usar el administrador de archivos o FTP. La estructura debe ser:

```text
raíz de tu cuenta/
├── gestion-comercial-servidor/  ← ZIP privado, fuera del directorio público
│   ├── app/
│   ├── vendor/
│   ├── storage/
│   └── .env.example
└── public_html/                ← o el directorio público de celenial.com.ar
    └── gestion-comercial/      ← ZIP público
        ├── .htaccess
        ├── index.php
        └── spa/
```

Descomprimir el ZIP privado en la raíz de la cuenta, y el público dentro de la raíz web del dominio. Cada ZIP ya incluye su carpeta superior; evitar duplicar los nombres al descomprimir. Borrar los ZIP del hosting al terminar.

El nombre `public_html` es ilustrativo: usar el directorio real de tu dominio. El `index.php` público busca el servidor dos niveles hacia arriba, en `gestion-comercial-servidor`. Si la cuenta usa otra distribución, editar `$server` en ese `index.php` y poner la ruta absoluta correcta. El código privado y `.env` deben quedar fuera de la raíz pública. Si el administrador no permite acceder fuera de ella, solicitar a soporte una carpeta privada antes de subir ese ZIP.

Apache debe permitir `.htaccess` y reescritura de URLs. Si hay WordPress u otro sitio en la raíz del dominio, comprobar que sus reglas respeten la carpeta existente `gestion-comercial`.

## 4. Crear el archivo .env de producción

Dentro de la carpeta privada, copiar `.env.example` como `.env`. Completar:

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_URL=https://celenial.com.ar/gestion-comercial
APP_KEY=base64:CLAVE_DEL_SISTEMA
DB_HOST=SERVIDOR_MYSQL_DEL_PANEL
DB_PORT=3306
DB_DATABASE=NOMBRE_COMPLETO_BASE
DB_USERNAME=USUARIO_COMPLETO
DB_PASSWORD="CONTRASEÑA"
SESSION_SECURE_COOKIE=true
SESSION_PATH=/gestion-comercial
```

Para trasladar el sistema actual, copiar **exactamente el valor de `APP_KEY` del `.env` local**, sin compartirlo por chat. Los certificados ARCA y sus claves están cifrados en la base con esa clave. Mantener un respaldo privado de la base y de `APP_KEY` juntos. No generar una clave nueva si se importan datos cifrados existentes.

Para una instalación independiente, generar una clave nueva en una consola local con `php artisan key:generate --show` desde `apps/server` y pegarla en el `.env` del hosting. Ese comando solo muestra una clave nueva; no cambia la local.

Los correos de recuperación e invitación salen desde `hola@celenial.com.ar`. Crear esa casilla en el panel de Ferozo y completar:

```dotenv
MAIL_MAILER=smtp
MAIL_SCHEME=smtps
MAIL_HOST=SERVIDOR_SMTP_DEL_PANEL
MAIL_PORT=465
MAIL_USERNAME=hola@celenial.com.ar
MAIL_PASSWORD="CLAVE_DE_LA_CASILLA"
MAIL_FROM_ADDRESS="hola@celenial.com.ar"
```

El servidor SMTP figura en la configuración de cliente de correo del panel. Con `MAIL_MAILER=log` los mensajes quedan en el registro y no se envían.

## 5. Instalar la base

Ferozo no permite crear disparadores (error `#1419 You do not have the SUPER privilege` en un `CREATE TRIGGER`). El sistema funciona igual sin ellos ([ADR 0011](adr/0011-disparadores-opcionales-en-hosting.md)), pero la base que se importa tiene que venir **sin disparadores**. Exportarla desde una consola en la PC:

```powershell
C:\xampp\mysql\bin\mysqldump.exe -P 3307 -u USUARIO -p --skip-triggers --no-tablespaces --add-drop-table gestioncomercial > base.sql
```

En phpMyAdmin local, la opción equivalente es desmarcar «Agregar CREATE TRIGGER» en la exportación personalizada.

**Si llevás los datos actuales y no tenés SSH:** actualizar primero la base local con `php artisan migrate` desde `apps/server`. En phpMyAdmin local, exportar esa base en SQL, con estructura y datos (todas las tablas). Crear una base vacía en Ferozo e importar el SQL con el phpMyAdmin del hosting. La exportación incluye usuarios, ventas, sesiones y credenciales fiscales cifradas: no dejar el SQL en una carpeta pública. Si se supera el límite de importación, usar compresión o pedir a soporte que lo importe.

**Si empezás desde cero y no tenés SSH:** crear una base local separada y vacía. Ejecutar las migraciones apuntando a esa base, sin modificar ni vaciar la base habitual:

```powershell
# Consola PowerShell nueva, dentro de apps/server.
# Crear previamente gestioncomercial_despliegue en phpMyAdmin.
$env:DB_DATABASE = 'gestioncomercial_despliegue'
php artisan migrate --force
# Solo si querés un operador del panel de plataforma:
php artisan platform:create-admin vos@dominio.com "Tu nombre"
```

Exportar `gestioncomercial_despliegue` e importarla en Ferozo. Cerrar esa consola al terminar, para no seguir trabajando con esa variable. Esta opción no lleva comercios, ventas ni certificados existentes; el operador que se crea es una cuenta real y debe usar su propia contraseña segura. No ejecutar `migrate:fresh` sobre la base habitual.

**Si tenés SSH:** en la carpeta privada, ejecutar `composer check-platform-reqs --no-dev` y `php artisan migrate --force` con la versión PHP del sitio. Podés crear el operador mediante `php artisan platform:create-admin`. No hace falta usar `php artisan serve`: el hosting sirve la aplicación con Apache/PHP.

## 6. Permisos y comprobación

El usuario que ejecuta PHP debe poder escribir en `gestion-comercial-servidor/storage` y `gestion-comercial-servidor/bootstrap/cache`. Usar los permisos y propietario que indique el proveedor; evitar permisos 777.

Abrir `https://celenial.com.ar/gestion-comercial/`. Verificar:

- Carga la pantalla de ingreso con sus estilos.
- Permite registrar un comercio o ingresar con un usuario importado.
- Navegar a Productos y recargar esa URL funciona.
- El panel de plataforma abre en `/gestion-comercial/plataforma/login`.
- La recuperación de contraseña envía un correo con el prefijo `/gestion-comercial/restablecer`.
- `https://celenial.com.ar/gestion-comercial/.env` y `/vendor/autoload.php` no muestran archivos privados.

Si aparece un error 500, revisar el registro privado `storage/logs/laravel.log` o el registro PHP del panel, manteniendo `APP_DEBUG=false`. No probar facturación real hasta validar PHP, SOAP y la conexión en homologación.

## Actualizaciones

Respaldar base y archivos antes de actualizar. Preparar nuevos paquetes, conservar el `.env`, `APP_KEY` y `storage` del servidor, y aplicar las migraciones pendientes. El procedimiento de exportar una base local completa corresponde a la instalación inicial: **no importar esa base encima de una instalación que ya recibe ventas**. Sin SSH, coordinar la ejecución de las migraciones con soporte.
