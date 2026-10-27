# 0009: Despliegue en la raíz o en una subcarpeta

El hosting de destino usa `celenial.com.ar/gestion-comercial`. Las rutas absolutas de la web impedían ese despliegue.

La compilación de Vite genera archivos con rutas relativas. Laravel agrega al HTML el directorio base que detecta en el pedido e informa ese prefijo mediante una etiqueta meta. El router y las llamadas a la API usan ese valor. El manifiesto usa rutas relativas a su ubicación. La misma compilación sigue funcionando en la raíz y con `php artisan serve`.

Solo los archivos públicos se colocan en la raíz web del hosting. El punto de entrada de despliegue carga Laravel desde una carpeta privada e informa a Laravel la ubicación de la carpeta pública. El alcance de las cookies se configura mediante `SESSION_PATH`, tanto al crearlas como al borrarlas. Los enlaces por correo conservan `APP_URL` como origen configurado.
