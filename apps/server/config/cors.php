<?php

/*
| La web se sirve desde el mismo origen que la API, así que no se habilita CORS para nadie.
| (Con cookies de sesión, abrir CORS solo agregaría superficie de ataque.)
*/
return [
    'paths' => [],
    'allowed_methods' => [],
    'allowed_origins' => [],
    'allowed_origins_patterns' => [],
    'allowed_headers' => [],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
