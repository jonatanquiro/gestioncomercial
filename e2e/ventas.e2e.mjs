// Prueba de punta a punta del punto de venta y la caja (Fase 4) contra una instancia real.
// Uso: E2E_BASE_URL=http://localhost:8000 node e2e/ventas.e2e.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8000';
const SHOTS = process.env.E2E_SCREENSHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now();
const owner = { name: 'Dueña Ventas', email: `ventas.${stamp}@example.com`, password: 'Kiosco-Ventas-2026' };
const alfajor = `779${String(stamp).slice(-10)}`;
const gaseosa = `778${String(stamp).slice(-10)}`;

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
// El diálogo de impresión del navegador no existe en la prueba: se registra que se pidió.
await page.addInitScript(() => {
  window.__printed = 0;
  window.print = () => {
    window.__printed += 1;
  };
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const step = (name) => console.log(`• ${name}`);
const dialog = () => page.getByRole('dialog').last();

/** Llamada a la API con la sesión y el token CSRF del navegador, para preparar datos. */
const api = (method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const csrf = decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('gc_csrf='))?.slice(8) ?? '');
      const res = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    },
    { method, path, body },
  );

const product = (name, price, code, stock) => ({
  kind: 'good', name, description: null, categoryId: null, brandId: null, saleMode: 'unit', vatRate: '21', trackStock: true, minStock: null,
  blockNegativeStock: false, sku: null, price, cost: null, barcodes: [{ code, quantityFactor: '1' }], initialStock: stock,
});

try {
  step('Registro de un kiosco y carga de dos artículos');
  await page.goto(`${BASE}/registro`);
  await page.getByLabel('Nombre del comercio').fill(`Kiosco Ventas ${stamp}`);
  await page.getByLabel('Rubro').selectOption({ label: 'Kiosco' });
  await page.getByLabel('Tu nombre').fill(owner.name);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Contraseña').fill(owner.password);
  await page.getByRole('button', { name: 'Crear mi comercio' }).click();
  await page.waitForURL(`${BASE}/app`);
  assert.equal((await api('POST', '/products', product('Alfajor triple', '1250.50', alfajor, '50'))).status, 201);
  assert.equal((await api('POST', '/products', product('Gaseosa 500 ml', '999.99', gaseosa, '10'))).status, 201);

  step('La caja arranca cerrada y se abre con el fondo inicial');
  if (await page.getByRole('button', { name: 'Operación', exact: true }).isVisible()) await page.getByRole('button', { name: 'Operación', exact: true }).click();
  await page.getByRole('link', { name: 'Vender', exact: true }).click();
  await page.getByText('Caja 1 está cerrada').waitFor();
  await page.getByLabel('Efectivo con el que arranca la caja').fill('10.000');
  await page.getByRole('button', { name: 'Abrir caja' }).click();

  step('Venta escaneando: el mismo código suma cantidad');
  const scanner = page.getByLabel('Escaneá o buscá un artículo');
  await scanner.waitFor();
  for (const code of [alfajor, alfajor, gaseosa]) {
    await scanner.fill(code);
    await scanner.press('Enter');
  }
  await page.getByRole('listitem', { name: 'Gaseosa 500 ml' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Cantidad de Alfajor triple"]')?.textContent === '2');
  await page.getByRole('button', { name: 'Sumar uno de Alfajor triple' }).click();
  await page.getByRole('button', { name: 'Restar uno de Alfajor triple' }).click();
  assert.equal(await page.getByLabel('Cantidad de Alfajor triple').textContent(), '2');
  await page.getByLabel('Cantidad de Gaseosa 500 ml').click();
  await dialog().getByLabel('Descuento %').fill('10');
  await dialog().getByLabel('Descuento %').press('Enter');
  await page.getByLabel('Total de la venta').getByText('$ 3.400,99').waitFor();
  await shot('20-venta');

  step('Cobro en efectivo con vuelto e impresión del ticket');
  await page.keyboard.press('F2');
  await dialog().getByLabel('Importe 1').fill('5000');
  await dialog().getByText('$ 1.599,01').waitFor();
  await shot('21-cobro');
  await dialog().getByRole('button', { name: 'Confirmar venta' }).click();
  await page.getByText('Venta N° 1 cobrada').waitFor();
  await page.getByRole('button', { name: 'Imprimir ticket' }).click();
  const ticket = page.locator('#print-root');
  await ticket.getByText('Comprobante no válido como factura').waitFor({ state: 'attached' });
  assert.match(await ticket.textContent(), /TOTAL\s*\$ 3\.400,99/);
  assert.match(await ticket.textContent(), /Su vuelto\s*\$ 1\.599,01/);
  await page.waitForFunction(() => window.__printed === 1);

  step('Pago combinado: débito con número de operación y el resto en efectivo');
  await scanner.fill(alfajor);
  await scanner.press('Enter');
  await page.getByRole('listitem', { name: 'Alfajor triple' }).waitFor();
  await page.getByRole('button', { name: 'Cobrar (F2)' }).click();
  await dialog().getByRole('button', { name: 'Débito', exact: true }).click();
  await dialog().getByLabel('Importe 1').fill('1000');
  await dialog().getByLabel('N° de operación 1').fill('004512');
  await dialog().getByRole('button', { name: 'Pagar el resto con otro medio' }).click();
  await dialog().getByRole('button', { name: 'Efectivo', exact: true }).click();
  assert.equal(await dialog().getByLabel('Importe 2').inputValue(), '250,5');
  await dialog().getByRole('button', { name: 'Confirmar venta' }).click();
  await page.getByText('Venta N° 2 cobrada').waitFor();

  step('20 artículos escaneados y cobrados en menos de 30 segundos');
  const started = Date.now();
  for (let i = 0; i < 20; i++) {
    await scanner.fill(i % 2 ? gaseosa : alfajor);
    await scanner.press('Enter');
    await page.waitForFunction(([name, n]) => document.querySelector(`[aria-label="Cantidad de ${name}"]`)?.textContent === n, [i % 2 ? 'Gaseosa 500 ml' : 'Alfajor triple', String(Math.floor(i / 2) + 1)]);
  }
  await page.keyboard.press('F2');
  await dialog().getByLabel('Importe 1').press('Enter');
  await page.getByText('Venta N° 3 cobrada').waitFor();
  const seconds = (Date.now() - started) / 1000;
  console.log(`  ${seconds.toFixed(1)} s`);
  assert.ok(seconds < 30, `la venta de 20 artículos tardó ${seconds} s`);

  step('Anulación de la venta 1 con motivo');
  if (await page.getByRole('button', { name: 'Operación', exact: true }).isVisible()) await page.getByRole('button', { name: 'Operación', exact: true }).click();
  await page.getByRole('link', { name: 'Ventas', exact: true }).click();
  await page.getByRole('link', { name: '1', exact: true }).click();
  await page.getByRole('heading', { name: 'Venta N° 1' }).waitFor();
  await page.getByRole('button', { name: 'Más acciones de la venta' }).click();
  await page.getByRole('menuitem', { name: 'Anular venta' }).click();
  await dialog().getByLabel('Motivo').fill('Cobrada dos veces');
  await dialog().getByRole('button', { name: 'Anular venta' }).click();
  await page.getByText(/Motivo: Cobrada dos veces/).waitFor();

  step('Devolución parcial de la venta 3');
  if (await page.getByRole('button', { name: 'Operación', exact: true }).isVisible()) await page.getByRole('button', { name: 'Operación', exact: true }).click();
  await page.getByRole('link', { name: 'Ventas', exact: true }).click();
  await page.getByRole('link', { name: '3', exact: true }).click();
  await page.getByRole('button', { name: 'Devolución' }).click();
  await dialog().getByLabel('Cantidad que devuelve de Gaseosa 500 ml').fill('1');
  await dialog().getByLabel('Motivo').fill('Vencida');
  await dialog().getByText('$ 999,99').waitFor();
  await shot('22-devolucion');
  await dialog().getByRole('button', { name: 'Registrar devolución' }).click();
  await page.getByRole('cell', { name: 'Vencida' }).waitFor();

  step('Stock descontado por las ventas y repuesto por la anulación y la devolución');
  const stock = await api('GET', '/stock?pageSize=10');
  const byName = Object.fromEntries(stock.body.items.map((r) => [r.name, r.onHand]));
  assert.equal(byName['Alfajor triple'], '39.000'); // 50 − 2 − 1 − 10 + 2 (anulación)
  assert.equal(byName['Gaseosa 500 ml'], '1.000'); // 10 − 1 − 10 + 1 (anulación) + 1 (devolución)

  step('Venta táctil: más vendidos, queso por importe y débito con botones');
  assert.equal((await api('POST', '/products', { ...product('Queso de máquina', '9000', `${stamp}9`, '5'), saleMode: 'weight', barcodes: [] })).status, 201);
  if (await page.getByRole('button', { name: 'Operación', exact: true }).isVisible()) await page.getByRole('button', { name: 'Operación', exact: true }).click();
  await page.getByRole('link', { name: 'Vender', exact: true }).click();
  await page.getByRole('region', { name: 'Más vendidos' }).getByRole('button', { name: /Alfajor triple/ }).click();
  await scanner.fill('Queso');
  await page.getByRole('listbox').getByRole('button', { name: /Queso de máquina/ }).click();
  await dialog().getByLabel('O el importe que pide el cliente ($)').fill('2000');
  assert.equal(await dialog().getByLabel('Cantidad (kg)').inputValue(), '0,222');
  await dialog().getByText('$ 1.998,00').waitFor();
  await dialog().getByRole('button', { name: 'Agregar' }).click();
  await page.getByLabel('Total de la venta').getByText('$ 3.248,50').waitFor();
  await shot('22-venta-tactil');
  await page.getByRole('button', { name: 'Cobrar (F2)' }).click();
  await dialog().getByRole('button', { name: 'Débito', exact: true }).click();
  await dialog().getByLabel('N° de operación 1').fill('778899');
  await dialog().getByRole('button', { name: 'Confirmar venta' }).click();
  await page.getByText('Venta N° 4 cobrada').waitFor();

  step('Cantidad por código: 3* y escanear carga tres de una vez');
  await scanner.fill('3*');
  await scanner.press('Enter');
  await page.getByText('× 3', { exact: true }).waitFor();
  await scanner.fill(gaseosa);
  await scanner.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="Cantidad de Gaseosa 500 ml"]')?.textContent === '3');
  await scanner.fill(`2*${gaseosa}`);
  await scanner.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="Cantidad de Gaseosa 500 ml"]')?.textContent === '5');
  await page.getByRole('button', { name: 'Cancelar la venta' }).click();

  step('Caja: retiro y cierre ciego con diferencia');
  if (await page.getByRole('button', { name: 'Operación', exact: true }).isVisible()) await page.getByRole('button', { name: 'Operación', exact: true }).click();
  await page.getByRole('link', { name: 'Caja', exact: true }).click();
  await page.getByRole('link', { name: 'Ver turno' }).click();
  await page.getByRole('button', { name: 'Retiro' }).click();
  await dialog().getByLabel('Importe que sale de la caja').fill('5000');
  await dialog().getByLabel('Motivo').fill('A la caja fuerte');
  await dialog().getByRole('button', { name: 'Registrar retiro' }).click();
  await page.getByRole('cell', { name: /A la caja fuerte/ }).waitFor();
  // Fondo 10.000 + 3.400,99 − 3.400,99 (anulada) + 250,50 + 22.504,90 − 999,99 − 5.000
  const expected = '$ 26.755,41';
  await page.getByText(expected).first().waitFor();
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  await dialog().getByLabel('Efectivo contado en el cajón').fill('26.750');
  await dialog().getByRole('button', { name: 'Cerrar caja' }).click();
  await page.getByRole('heading', { name: 'Caja 1 · turno cerrado' }).waitFor();
  await page.getByText('-$ 5,41').first().waitFor();
  await shot('23-cierre');

  step('Turno cerrado: ya no se puede operar');
  if (await page.getByRole('button', { name: 'Operación', exact: true }).isVisible()) await page.getByRole('button', { name: 'Operación', exact: true }).click();
  await page.getByRole('link', { name: 'Vender', exact: true }).click();
  await page.getByText('Caja 1 está cerrada').waitFor();

  assert.deepEqual(errors, [], `errores de JavaScript en la página: ${errors.join('; ')}`);
  console.log('E2E de ventas OK');
} catch (err) {
  await shot('error-ventas');
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
