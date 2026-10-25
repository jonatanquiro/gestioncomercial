// Variables para las pruebas de integración. La base de pruebas se recrea en global-setup.
process.env.NODE_ENV = 'test';
// Siempre la base de pruebas, aunque el entorno tenga DATABASE_URL de desarrollo.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://gc_app:gc_app@localhost:5432/gestioncomercial_test';
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.APP_URL ??= 'http://localhost:5173';
