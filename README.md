# Gestión Comercial

SaaS multiempresa de gestión comercial para comercios minoristas de Argentina: punto de venta, inventario, caja, compras, cuentas corrientes y factura electrónica ARCA, con venta sin conexión (PWA).

El desarrollo avanza por fases. **Estado actual: punto de venta y caja, rendición de cobros, apariencia por comercio y primera integración ARCA para bienes en pesos, en PHP + MySQL.** Incluye:
- inicio con el resumen del día: lo vendido, el efectivo en caja, los cobros sin rendir y el stock bajo, según los permisos de cada usuario;
- registro de comercios, sesiones y recuperación de contraseña;
- sucursales, empleados, roles y permisos;
- auditoría y aislamiento entre comercios;
- el panel de la plataforma;
- productos y servicios con varios códigos de barras y códigos de pack, categorías iniciales según el rubro, marcas e historial de precios y costos;
- stock por depósito con movimientos inalterables, ajustes, mermas y vencimientos con motivo, alerta de stock mínimo e inventario físico;
- cambio masivo de precios con vista previa exacta, recargo sobre costo o margen sobre precio y redondeo;
- punto de venta pensado también para pantallas táctiles: lector de códigos, accesos rápidos a los más vendidos, botones de cantidad, carga de peso o medida (o del importe que pide el cliente), medios de pago en botones, billetes sugeridos con vuelto, teclado numérico en pantalla (aparece solo en pantallas táctiles y se puede activar o esconder), descuentos con tope y autorización por PIN, pagos combinados, nombre y teléfono opcionales de quien transfiere o paga con QR, «cantidad * código» (por ejemplo `12*` y escanear), barra fija para cobrar en el celular y ticket interno de 80 mm;
- caja por turnos: apertura con fondo, retiros e ingresos, arqueos, cierre ciego con diferencia y totales por medio de pago;
- historial de ventas con anulación en el turno y devoluciones parciales, con movimientos inversos de stock y caja.
- listado de cobros electrónicos (transferencias, QR, tarjetas) con filtros, estado de rendición y señales de N° de operación repetido o faltante;
- rendiciones de cobros electrónicos con importación CSV configurable, revisión manual, vinculación y cierre auditado;
- estilo propio «Almacén de barrio» (papel crema, menú verde almacén y acento tomate) con logo, fuente, colores, tamaño de texto, tablas compactas y menú lateral o superior configurables por comercio;
- cambio individual de plan desde la plataforma, con control de límites y conservación de fechas;
- configuración de certificados ARCA por comercio y ambiente, CSR, autenticación WSAA y solicitud/consulta de CAE para facturas A/B/C de bienes en ARS sin otros tributos, que se emiten desde la venta o al terminar de cobrar; el permiso «Emitir facturas electrónicas» deja facturar sin administrar certificados (ver alcance fiscal más abajo).

Si ya tenías instalada una versión anterior, después de actualizar el código corré `php artisan migrate` (o `iniciar.bat`): crea las tablas nuevas, les carga a los comercios existentes las categorías de su rubro y les crea "Caja 1" en cada sucursal y los medios de pago habituales.

## Requisitos

- **XAMPP 8.2** (PHP 8.2 + MariaDB), o cualquier PHP 8.2+ con MySQL 8 o MariaDB 10.4+
- **Composer 2** (https://getcomposer.org)
- Node.js **no** hace falta para usar el sistema: la web ya viene compilada en `apps/server/public/spa`. Solo se necesita para modificar las pantallas.

## Actualizar y arrancar con un doble clic (Windows)

`iniciar.bat` hace todo solo: baja la última versión desde GitHub (la primera vez clona el repositorio), corre `composer install`, crea `.env` si no existe, actualiza la base con `php artisan migrate` y levanta el sistema en http://localhost:8000 abriendo el navegador. Necesita Git para Windows, Composer y MySQL iniciado en el panel de XAMPP. Se puede dejar dentro de la carpeta del repositorio o en la carpeta que lo contiene (por ejemplo `C:\xampp\htdocs`). Descarta cambios hechos a mano en el código; `.env` no se toca.

## Instalar en XAMPP (Windows)

1. Iniciar **Apache** y **MySQL** desde el panel de XAMPP.
2. En phpMyAdmin (http://localhost/phpmyadmin) crear la base `gestioncomercial` con cotejamiento `utf8mb4_unicode_ci`. Para las pruebas automáticas, crear también `gestioncomercial_test`.
3. En una consola, dentro de la carpeta del repositorio:

   ```bash
   cd apps/server
   composer install
   copy .env.example .env        # en Linux o macOS: cp .env.example .env
   php artisan key:generate
   php artisan migrate
   ```

   `.env.example` ya trae la configuración de XAMPP: usuario `root` sin contraseña. `migrate` crea las tablas y carga permisos, rubros y planes.
   Si tu MySQL tiene contraseña para `root` (el error dice `Access denied for user 'root'@'localhost' (using password: NO)`), ponela en `DB_PASSWORD` dentro de `.env` y volvé a correr `migrate`. Si ya estaba andando `php artisan serve`, reinicialo. Si en la PC hay otro MySQL instalado aparte de XAMPP (por ejemplo el servicio "MySQL80"), el de XAMPP suele quedar en otro puerto, como el 3307: fijate cuál usa phpMyAdmin y ponelo en `DB_PORT`.

4. Levantar el sistema:

   ```bash
   php artisan serve
   ```

   Entrar a **http://localhost:8000** y registrar un comercio.

Si Composer avisa que falta una extensión de PHP (por ejemplo `fileinfo` o `zip`), activarla quitando el `;` de su línea en `C:\xampp\php\php.ini` y reiniciar la consola.

### Con Apache de XAMPP, sin `php artisan serve`

La raíz pública debe apuntar a `apps/server/public`. Para XAMPP se puede agregar un VirtualHost en `C:\xampp\apache\conf\extra\httpd-vhosts.conf`:

```apache
Listen 8080
<VirtualHost *:8080>
    DocumentRoot "C:/xampp/htdocs/gestioncomercial/apps/server/public"
    <Directory "C:/xampp/htdocs/gestioncomercial/apps/server/public">
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

Reiniciar Apache, poner `APP_URL=http://localhost:8080` en `.env` y entrar a http://localhost:8080.

También se puede instalar en una subcarpeta, por ejemplo `https://celenial.com.ar/gestion-comercial`. Ver [la guía de despliegue en Ferozo](docs/despliegue-ferozo.md) y el generador de paquetes `scripts/preparar-ferozo.ps1`. El código privado y `.env` se guardan fuera de la raíz pública.

Si el hosting no deja crear disparadores (en phpMyAdmin aparece un error en un `CREATE TRIGGER`), el sistema funciona igual, pero esas tablas quedan protegidas solo por el programa ([ADR 0011](docs/adr/0011-disparadores-opcionales-en-hosting.md)). Para llevar una base de la PC, exportarla sin disparadores (`mysqldump --skip-triggers`).

### Correos

Con `MAIL_MAILER=log`, los correos (por ejemplo, el de recuperación de contraseña) se escriben en `apps/server/storage/logs/laravel.log`. Para verlos como correo real se puede usar Mailpit, configurando `MAIL_MAILER=smtp`, `MAIL_HOST=127.0.0.1` y `MAIL_PORT=1025`.

### Crear un operador del panel de plataforma

El panel está en `/plataforma`. Se entra con el email y la contraseña del operador.

```bash
cd apps/server
php artisan platform:create-admin vos@dominio.com "Tu nombre"
```

El comando pide la contraseña (mínimo 10 caracteres).

Desde el panel se pueden dar de alta comercios a mano (botón **Nuevo comercio**): se elige rubro y plan y se carga el nombre y email del dueño, que queda con rol **Propietario**. Para una cuenta nueva hay dos alternativas:

- **Definir una contraseña inicial** en el formulario (mínimo 10 caracteres, máximo 128; se rechazan contraseñas demasiado comunes). El dueño entra directamente en `/login` con su email y esa contraseña, sin necesitar correo. El operador debe compartirle la contraseña y el dueño puede cambiarla desde **Mi cuenta**. Se guarda únicamente su hash y no se incluye en la auditoría ni en la respuesta del alta.
- **Dejar la contraseña vacía**: el dueño recibe un correo con un enlace para elegirla (vence en 7 días). Con `MAIL_MAILER=log`, la invitación se escribe en `apps/server/storage/logs/laravel.log`; para enviarla a una casilla real se necesita configurar SMTP.

Si ese email ya tenía cuenta, el comercio se suma a los suyos y entra con su contraseña de siempre. En ese caso, se debe dejar vacía la contraseña inicial: el alta rechaza cualquier intento de reemplazar la contraseña de una cuenta existente.

El panel también permite:

- Buscar comercios por nombre o CUIT y filtrarlos por estado.
- Consultar el plan asignado, el vencimiento de la prueba y la cantidad de sucursales y usuarios activos.
- Suspender o habilitar un comercio indicando un motivo que queda auditado.
- Editar los planes existentes: nombre, precio mensual, días de prueba, límites de sucursales, usuarios, productos y cajas, funciones incluidas y disponibilidad para nuevas altas.

Editar un plan cambia su definición para todos los comercios que lo usan. Para cambiar solo un kiosco, usar **Cambiar plan** en su fila: se elige un plan activo y se indica un motivo. El cambio es inmediato, no reinicia la prueba ni cambia el estado de la suscripción, y no genera cargos. Si el uso de sucursales, usuarios, productos o cajas supera los límites del nuevo plan, se rechaza. Una edición desactualizada también se rechaza para no pisar cambios de otro operador.

La API dispone de auditoría de plataforma (`GET /api/v1/platform/audit`), pero el panel todavía no tiene una pantalla para consultarla. Marcar una función en un plan no implementa los módulos que siguen pendientes.

### Cargar el catálogo de referencia de productos (Precios Claros / SEPA)

Los comercios usan los datos abiertos de SEPA (Precios Claros) de dos maneras. En **Productos → Agregar desde catálogo** buscan lo que venden, lo tildan, le ponen su precio y, opcionalmente, su stock inicial, y lo agregan de una vez. Y al dar de alta un producto, si escanean o escriben un código que no tienen cargado, se completan el nombre y la marca. El catálogo es común a todos los comercios y no guarda precios.

El campo **Stock inicial** aparece para quienes tienen el permiso `stock.adjust`. Acepta cantidades enteras no negativas, porque los productos del catálogo se crean con venta por unidad. Al dejarlo vacío, el stock queda en 0. Una cantidad mayor que 0 se registra como un movimiento de ajuste con motivo «Stock inicial» en el depósito principal, dentro de la misma transacción que crea el producto. Se cargan activos, con IVA 21 %; estos datos se pueden editar después.

1. Bajá el ZIP de un día del dataset **Precios Claros - Base SEPA** en [datos.produccion.gob.ar](https://datos.produccion.gob.ar/dataset/sepa-precios). Pesa varios cientos de MB.
2. Importalo:

```bash
cd apps/server
php artisan catalogo:importar-sepa C:\Users\vos\Downloads\sepa_lunes.zip
```

Tarda unos minutos. También acepta la carpeta ya descomprimida o un `productos.csv` suelto. Para actualizarlo, se vuelve a correr con un archivo más nuevo. Leer el ZIP directamente requiere `extension=zip` activa en el `php.ini` de XAMPP. Si no está activa, descomprimí el archivo y pasá la carpeta.

### Estado de la facturación ARCA y certificados

En **Administración → Facturación ARCA** (`/app/facturacion`), con permiso `fiscal.manage`, se configuran el CUIT, el punto de venta y las credenciales de cada comercio, separadas entre **homologación** y **producción**. Se puede generar un pedido CSR con una clave nueva, o importar un certificado y su clave PEM. La clave, el certificado y los tickets de acceso se guardan cifrados con `APP_KEY`; no se muestran, no se descargan y no se incluyen en auditorías. Es necesario respaldar la base y conservar `APP_KEY` para poder recuperar esas credenciales.

ARCA entrega un solo ticket de acceso vigente por certificado (dura hasta 12 horas): usar un certificado exclusivo para este sistema y para cada comercio, sin compartirlo con otra aplicación. Guardar la configuración sin cambiar certificado, clave ni CUIT conserva el ticket. En homologación es normal que ARCA no informe puntos de venta; se puede usar cualquier número.

La generación del CSR no habilita por sí sola el servicio: hay que obtener el certificado en ARCA, asociarlo a WSFE y cargarlo acá. **Probar conexión y puntos de venta** verifica la autenticación y consulta los puntos de venta de la cuenta. Usar un punto de venta dedicado a este sistema. No se copian certificados, claves ni tickets de `gestion-silvia`; se adaptó su lógica de autenticación y generación de pedidos, manteniendo validación TLS y separación por comercio.

Desde una venta se puede abrir **Facturar en ARCA**, o elegirla en la pantalla fiscal. Esta primera versión solicita CAE para facturas A y B de responsables inscriptos, y C de monotributistas/exentos, de **bienes en pesos y sin otros tributos**. Usa los importes y alícuotas congelados de la venta. Guarda el pedido y su número antes de enviarlo. Si hay un timeout, el reintento consulta ese mismo comprobante y contrasta sus datos; no avanza a otro número. Un rechazo confirmado permite corregir la solicitud. Un pendiente bloquea nuevas emisiones de ese comercio y ambiente hasta resolverse. La función `fiscal_arca` del plan se exige para emitir comprobantes nuevos; quitarla no impide consultar comprobantes previos ni recuperar un pendiente.

Los comprobantes autorizados tienen impresión con CAE y QR generado localmente. Los de homologación llevan la marca **sin validez fiscal**; el ticket interno de caja sigue siendo un documento distinto. Antes de usar producción se deben validar los datos del emisor y del receptor, el certificado, la habilitación de WSFE, el punto de venta y el circuito completo en homologación. Producción exige además razón social, domicilio, CUIT del comercio, Ingresos Brutos/información de exención y fecha de inicio de actividades, y una confirmación expresa en cada solicitud.

**Alcance pendiente:** notas de crédito, servicios, otras monedas, impuestos internos y otros tributos, exportaciones, comprobantes especiales y validación en vivo con certificados habilitados. Una venta con factura de producción autorizada o pendiente no puede anularse ni devolverse desde caja: requiere resolver su estado y la nota de crédito fiscal, que esta versión todavía no emite. No usar la emisión de esta versión para operaciones que necesiten los conceptos pendientes. Las pruebas fiscales automáticas simulan las respuestas del organismo; no emiten comprobantes reales.

Referencias oficiales: [WSAA y asociación de certificados](https://www.afip.gob.ar/ws/documentacion/wsaa.asp), [manuales WSFE](https://www.afip.gob.ar/fe/ayuda/webservice.asp), [especificaciones del QR](https://www.afip.gob.ar/fe/qr/).

### Rendición de transferencias, QR y tarjetas

En **Operación → Cobros** (`/app/cobros`), con permiso `cash.read_all`, se consultan uno por uno los cobros que no son en efectivo. Se filtran por fechas de venta, tipo, medio de pago, caja, estado de rendición y búsqueda por N° de operación, venta o importe. Se señalan los cobros sin N° de operación, los que repiten el N° de otro cobro del mismo medio en ventas vigentes y los de ventas anuladas o con devolución. Con un medio de pago y fechas elegidos, **Crear rendición** abre la rendición de ese período. La pantalla solo consulta: la verificación se hace en la rendición.

En **Operación → Rendición de cobros** (`/app/rendiciones`), con permiso `cash.read_all`:

1. Crear medios de pago separados por cuenta/terminal, por ejemplo **MP · QR**, **Ualá · Débito** y **Banco · Transferencia**, conservando el tipo de pago correcto. Activar el pedido de número de operación para facilitar el cruce.
2. Crear una rendición para un medio y un período de ventas. Las fechas son de Argentina. No pueden superponerse con otra rendición abierta de esa cuenta. Después de cerrar, una nueva rendición de las mismas fechas recoge únicamente los cobros que todavía no fueron incluidos. Hasta 2000 cobros por rendición.
3. Importar un CSV de cobros positivos en ARS o verificar los cobros manualmente. Seleccionar delimitador, separador decimal y columnas de identificador, bruto y deducciones o neto; la fecha de acreditación es opcional en formato `AAAA-MM-DD`. Hasta 2 MB y 2000 filas por importación. [Ejemplo](docs/ejemplos/rendicion.csv).
4. El cruce automático exige **una referencia única y el mismo bruto** dentro de esa rendición. Las operaciones ambiguas o sin venta quedan pendientes; se pueden vincular manualmente con motivo. No se confirma por importe y fecha solamente. Los identificadores repetidos del archivo o ya importados se rechazan sin agregar filas.
5. Revisar movimientos, registrar deducciones, neto y acreditación, y marcar confirmado u observado con una explicación. Una venta anulada o con devolución se señala; no se compensan esas operaciones automáticamente.
6. Usar **Actualizar cobros del período** si hubo ventas posteriores a la creación. El cierre exige revisar todos los movimientos y registrar una nota. Conserva el responsable y la auditoría; después no se modifica.

Confirmar el cobro y verificar la fecha de acreditación son controles distintos. Los totales importados incluyen filas todavía sin vincular: revisar su estado. Las devoluciones, transferencias entre cuentas, contracargos, retenciones separadas y otros movimientos deben separarse del archivo de cobros; el campo deducciones representa el total descontado del bruto. Las discrepancias se registran como observaciones.

Esta etapa **no conecta automáticamente APIs de Mercado Pago, Ualá o bancos**, no valida comprobantes enviados por clientes y no modifica el saldo del cajón. Funciona con reportes preparados/exportados y revisión humana; los adaptadores por proveedor y la sincronización automática quedan como próxima etapa.

## Pruebas

```bash
cd apps/server && php artisan test   # PHPUnit contra la base gestioncomercial_test (se recrea en cada corrida)
pnpm typecheck && pnpm test          # web y paquetes compartidos
pnpm e2e                             # navegador; requiere el sistema levantado (ver el inicio de e2e/nucleo.e2e.mjs)
```

Las pruebas de PHP nunca tocan la base de trabajo: con `APP_ENV=testing` usan siempre `DB_TEST_DATABASE`.

Los E2E crean comercios y ventas: ejecutarlos contra una instancia dedicada a pruebas. `E2E_BASE_URL` indica su URL. En Windows se puede usar el Edge instalado con `E2E_BROWSER_CHANNEL=msedge`; si no se define, Playwright usa su Chromium. La prueba de rendiciones también recorre la apariencia y la generación de CSR, sin conectarse a ARCA. Para cubrir el panel en `nucleo.e2e.mjs`, configurar `E2E_PLATFORM_EMAIL` y `E2E_PLATFORM_PASSWORD` de un operador de esa instancia de pruebas.

## Modificar las pantallas (requiere Node 22 y pnpm 10)

```bash
pnpm install
pnpm dev:web      # http://localhost:5173, redirige /api a php artisan serve (puerto 8000)
pnpm build        # compila a apps/server/public/spa: hay que commitear el resultado
```

Los permisos, roles plantilla y rubros se definen una sola vez en `packages/contracts`. Después de cambiarlos, correr `pnpm catalog`. Eso regenera `apps/server/database/catalog.json`, que hay que commitear. CI verifica que la web compilada y el catálogo estén al día.

### Diseño visual y documentación

En **Administración → Apariencia** (`/app/apariencia`), con permiso `settings.manage`, cada comercio puede guardar logo, fuente, color principal, color de menú, tamaño de texto, espaciado de tablas y **menú lateral o superior**. El logo acepta PNG, JPEG o WebP hasta 250 KB y 2000 × 2000 píxeles y también se muestra en el ticket interno. El color principal se valida para mantener contraste con texto blanco. Los textos del menú se ajustan a su fondo. Hay vista previa y restauración de valores originales (hay que guardar para aplicarla). La configuración se aplica a todos los usuarios del comercio, y no afecta otros comercios ni el panel de plataforma.

El menú lateral es el valor inicial. Ambas variantes agrupan **Operación**, **Catálogo**, **Inventario** y **Administración**. Los grupos y accesos respetan los permisos del usuario; la sección actual queda marcada. Los desplegables superiores se cierran al elegir una opción, hacer clic fuera o presionar Escape. En celular, el botón del encabezado abre las mismas secciones en un menú vertical desplazable.

El inicio muestra accesos rápidos a venta, caja, productos e inventario, junto con los datos reales del comercio y el uso de su plan. La fecha se presenta en la zona `America/Buenos_Aires`. Los títulos usan Archivo, incluida localmente, y los textos usan la tipografía del sistema. El acceso y el panel de plataforma comparten la misma identidad. La paleta y los estilos de navegación se definen en `apps/web/src/styles.css`; los componentes están en `apps/web/src/components/ui`. El ícono y los colores de la aplicación instalada se mantienen en `apps/web/public` y `apps/web/index.html`.

Cada cambio funcional o visual debe acompañarse de la actualización de la documentación correspondiente. El README describe el comportamiento disponible; `docs/adr` registra decisiones de arquitectura cuando corresponde. Antes de ejecutar `iniciar.bat`, los cambios deben estar guardados y subidos a la rama que descarga el archivo: el actualizador reemplaza modificaciones locales. Para iniciar sin actualizar, usar `php artisan serve` desde `apps/server`.

## Variables de entorno

Están documentadas en [`apps/server/.env.example`](apps/server/.env.example). Nunca se sube `.env`. En producción:
- `APP_KEY` propia;
- `APP_DEBUG=false`;
- `SESSION_SECURE_COOKIE=true` con HTTPS;
- un usuario de base con contraseña;
- un servidor de correo real.

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/server` | Laravel 12: API `/api/v1`, migraciones, pruebas y la web compilada (`public/spa`) |
| `apps/web` | Pantallas en React (PWA) |
| `packages/contracts` | Esquemas, permisos, roles y rubros compartidos (fuente de `catalog.json`) |
| `packages/domain` | Lógica pura de la web (dinero, precios) |
| `e2e` | Prueba de punta a punta en navegador |
| `docs/adr` | Decisiones de arquitectura |

## Decisiones de arquitectura

- [0005 · PHP + MySQL compatible con XAMPP (Laravel 12)](docs/adr/0005-php-mysql-xampp.md)
- [0006 · Aislamiento entre comercios en MySQL](docs/adr/0006-aislamiento-sin-rls.md)
- [0003 · Sesiones y autenticación](docs/adr/0003-sesiones-y-autenticacion.md)
- [0004 · Estrategia de pruebas](docs/adr/0004-pruebas.md)
- [0008 · Rendiciones, apariencia y primera integración fiscal](docs/adr/0008-rendiciones-apariencia-y-fiscal.md)
- [0009 · Despliegue en la raíz o en una subcarpeta](docs/adr/0009-despliegue-subcarpeta.md)
- [0010 · Ingreso con nombre de usuario o email](docs/adr/0010-ingreso-con-usuario.md)
- [0011 · Disparadores opcionales en hostings que no los permiten](docs/adr/0011-disparadores-opcionales-en-hosting.md)
- Históricas: [0001](docs/adr/0001-stack-y-estructura.md) y [0002](docs/adr/0002-aislamiento-multiempresa.md), del stack anterior en Node y PostgreSQL
