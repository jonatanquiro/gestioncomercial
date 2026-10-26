// Prueba de punta a punta del núcleo (Fase 2) contra una instancia real (Laravel + web compilada + MySQL).
// Uso: E2E_BASE_URL=http://localhost:8000 E2E_PLATFORM_EMAIL=... E2E_PLATFORM_PASSWORD=... node e2e/nucleo.e2e.mjs
// El operador se crea con php artisan platform:create-admin.
// Sin las variables E2E_PLATFORM_* se omite la parte del panel de plataforma; sin E2E_MAILPIT_URL, la recuperación de contraseña.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Se resuelve como CommonJS: toma la dependencia del repositorio o, si no está, una instalación global vía NODE_PATH.
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8000';
const SHOTS = process.env.E2E_SCREENSHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now();
const owner = { name: 'Dueña Prueba', email: `duena.${stamp}@example.com`, password: 'Kiosco-Prueba-2026' };
const cashier = { name: 'Cajero Prueba', email: `cajero.${stamp}@example.com`, password: 'Cajero-Prueba-2026' };
const tradeName = `Kiosco E2E ${stamp}`;
const invited = { name: 'Dueño Invitado', email: `invitado.${stamp}@example.com`, password: 'Almacen-Prueba-2026', tradeName: `Almacén E2E ${stamp}` };

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const step = (name) => console.log(`• ${name}`);

async function login(user) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL(`${BASE}/app`);
}

/** Texto del último correo recibido por `to` en Mailpit (espera hasta 10 s). */
async function mailText(mailpit, to) {
  for (let i = 0; i < 20; i++) {
    const found = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    if (found.messages?.length) return (await (await fetch(`${mailpit}/api/v1/message/${found.messages[0].ID}`)).json()).Text;
    await new Promise((r) => setTimeout(r, 500));
  }
  return '';
}

async function choosePassword(text, password) {
  const token = /restablecer\?token=([^\s]+)/.exec(text)?.[1];
  assert.ok(token, 'el correo debe traer el enlace para elegir la contraseña');
  await page.goto(`${BASE}/restablecer?token=${token}`);
  await page.getByLabel('Contraseña nueva').fill(password);
  await page.getByLabel('Repetir contraseña').fill(password);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await page.waitForURL(`${BASE}/login`);
}

async function logout() {
  await page.getByRole('button', { name: 'Salir' }).click();
  await page.waitForURL(`${BASE}/login`);
}

try {
  step('Sin sesión, /app redirige al ingreso');
  await page.goto(`${BASE}/app/empleados`);
  await page.waitForURL(`${BASE}/login`);

  step('Registro de comercio');
  await page.goto(`${BASE}/registro`);
  await page.getByLabel('Nombre del comercio').fill(tradeName);
  await page.getByLabel('Rubro').selectOption({ label: 'Kiosco' });
  await page.getByLabel('Tu nombre').fill(owner.name);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Contraseña').fill('corta');
  await page.getByRole('button', { name: 'Crear mi comercio' }).click();
  await page.getByText('al menos 10', { exact: false }).first().waitFor();
  await page.getByLabel('Contraseña').fill(owner.password);
  await page.getByRole('button', { name: 'Crear mi comercio' }).click();
  await page.waitForURL(`${BASE}/app`);
  await page.getByRole('banner').getByText(tradeName).waitFor();
  await shot('01-inicio');

  step('Alta de empleado con rol Cajero en Casa central');
  if (await page.getByRole('button', { name: 'Administración', exact: true }).isVisible()) await page.getByRole('button', { name: 'Administración', exact: true }).click();
  await page.getByRole('link', { name: 'Empleados' }).click();
  await page.getByRole('button', { name: 'Nuevo empleado' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre y apellido').fill(cashier.name);
  await dialog.getByLabel('Email').fill(cashier.email);
  await dialog.getByLabel('Contraseña inicial').fill(cashier.password);
  await dialog.getByLabel('Rol').selectOption({ label: 'Cajero' });
  await dialog.getByLabel('Casa central').check();
  await dialog.getByRole('button', { name: 'Crear empleado' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('cell', { name: cashier.email }).waitFor();
  await page.getByPlaceholder('Buscar por nombre, email o rol').fill('cajero');
  await page.getByRole('cell', { name: owner.email }).waitFor({ state: 'detached' });
  await page.getByRole('cell', { name: cashier.email }).waitFor();
  await shot('02-empleados');
  await logout();

  step('El cajero no ve ni puede abrir la administración de empleados');
  await login(cashier);
  if (await page.getByRole('button', { name: 'Administración', exact: true }).isVisible()) await page.getByRole('button', { name: 'Administración', exact: true }).click();
  assert.equal(await page.getByRole('link', { name: 'Empleados' }).count(), 0);
  await page.goto(`${BASE}/app/empleados`);
  await page.getByText('No tenés permiso para ver esta sección').waitFor();
  const status = await page.evaluate(async () => (await fetch('/api/v1/employees')).status);
  assert.equal(status, 403, 'la API debe rechazar al cajero');
  await shot('03-cajero-sin-permiso');
  await logout();

  step('La auditoría registra el alta del empleado');
  await login(owner);
  if (await page.getByRole('button', { name: 'Administración', exact: true }).isVisible()) await page.getByRole('button', { name: 'Administración', exact: true }).click();
  await page.getByRole('link', { name: 'Auditoría' }).click();
  await page.getByRole('cell', { name: 'Alta de empleado' }).first().waitFor();
  await shot('04-auditoria');
  await logout();

  const mailpit = process.env.E2E_MAILPIT_URL;
  if (mailpit) {
    step('Recuperación de contraseña por correo (Mailpit)');
    await page.goto(`${BASE}/recuperar`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await page.getByRole('alert').or(page.getByRole('status')).first().waitFor();
    owner.password = 'Kiosco-Nueva-2026';
    await choosePassword(await mailText(mailpit, owner.email), owner.password);
    await login(owner);
    await logout();
  } else {
    step('Recuperación de contraseña omitida (falta E2E_MAILPIT_URL)');
  }

  const { E2E_PLATFORM_EMAIL: pEmail, E2E_PLATFORM_PASSWORD: pPassword } = process.env;
  if (pEmail && pPassword) {
    step('La plataforma suspende el comercio');
    await page.goto(`${BASE}/plataforma/login`);
    await page.getByLabel('Email').fill(pEmail);
    await page.getByLabel('Contraseña').fill(pPassword);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForURL(`${BASE}/plataforma`);
    await page.getByPlaceholder('Buscar por nombre o CUIT').fill(tradeName);
    const row = page.getByRole('row').filter({ hasText: tradeName });
    step('La plataforma reasigna el plan de un comercio');
    await row.getByRole('button', { name: 'Cambiar plan' }).click();
    await page.getByRole('dialog').getByLabel('Nuevo plan').selectOption('profesional');
    await page.getByRole('dialog').getByLabel('Motivo del cambio').fill('Ampliación solicitada en prueba E2E');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar cambio de plan' }).click();
    await row.getByText('Profesional', { exact: false }).waitFor();
    await row.getByRole('button', { name: 'Suspender' }).click();
    await page.getByRole('dialog').getByLabel('Motivo').fill('Prueba E2E');
    await page.getByRole('dialog').getByRole('button', { name: 'Suspender' }).click();
    await row.getByText('Suspendido').waitFor();
    await shot('05-plataforma');

    step('La plataforma da de alta un comercio a mano');
    await page.getByRole('button', { name: 'Nuevo comercio' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nombre del comercio').fill(invited.tradeName);
    await dialog.getByLabel('Rubro').selectOption('almacen');
    await dialog.getByLabel('Nombre del dueño').fill(invited.name);
    await dialog.getByLabel('Email del dueño').fill(invited.email);
    await dialog.getByLabel('Contraseña inicial del dueño (opcional)').fill(invited.password);
    await dialog.getByRole('button', { name: 'Crear comercio' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByPlaceholder('Buscar por nombre o CUIT').fill(invited.tradeName);
    await page.getByRole('row').filter({ hasText: invited.tradeName }).waitFor();

    step('El comercio suspendido no puede operar');
    await page.context().clearCookies();
    await login(owner);
    await page.getByText('Comercio suspendido').waitFor();
    const blocked = await page.evaluate(async () => (await fetch('/api/v1/branches')).status);
    assert.equal(blocked, 403);
    await shot('06-suspendido');

    step('El dueño del comercio dado de alta entra con la contraseña definida desde plataforma');
    await page.context().clearCookies();
    await login(invited);
    await page.getByText(invited.tradeName).first().waitFor();
    await shot('07-invitado');
  } else {
    step('Panel de plataforma omitido (faltan variables E2E_PLATFORM_*)');
  }

  assert.deepEqual(errors, [], `errores de JavaScript en la página: ${errors.join('; ')}`);
  console.log('E2E OK');
} catch (err) {
  await shot('error');
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
