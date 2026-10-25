-- Inicialización local (Docker Compose y CI). En producción, crear estos roles
-- con la consola del proveedor y contraseñas propias.
--
-- gc_owner: dueño de las tablas; corre migraciones. Nunca lo usa la API.
-- gc_app:   rol de conexión de la API. NOINHERIT: no tiene permisos propios y en
--           cada transacción debe hacer SET LOCAL ROLE a gc_tenant, gc_auth o
--           gc_platform (los crean las migraciones). Si se olvida, falla cerrado.
CREATE ROLE gc_owner LOGIN PASSWORD 'gc_owner' CREATEROLE;
CREATE ROLE gc_app LOGIN PASSWORD 'gc_app' NOINHERIT;
CREATE DATABASE gestioncomercial OWNER gc_owner;
CREATE DATABASE gestioncomercial_test OWNER gc_owner;
