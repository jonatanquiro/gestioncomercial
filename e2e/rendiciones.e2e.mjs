// Prueba funcional contra una instancia de pruebas: crea un comercio y una venta.
// E2E_BASE_URL=http://127.0.0.1:8001 E2E_BROWSER_CHANNEL=msedge node e2e/rendiciones.e2e.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8000';
const SHOTS = process.env.E2E_SCREENSHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = name => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
async function api(method, path, data) {
  const csrf = (await page.context().cookies()).find(c => c.name === 'gc_csrf')?.value;
  const response = await page.request.fetch(`${BASE}/api/v1${path}`, { method, data, headers: csrf ? { 'x-csrf-token': csrf } : {} });
  const body = await response.json();
  assert.ok(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`);
  return body;
}
try {
  console.log('• Preparar venta por transferencia en un comercio de prueba');
  const stamp = Date.now();
  await api('POST', '/auth/register', { tradeName: `Kiosco Cobros ${stamp}`, taxCondition: 'monotributo', businessTypeCode: 'kiosco', ownerName: 'Dueño Prueba', email: `cobros.${stamp}@example.com`, password: 'clave-prueba-cobros-2026' });
  const [register] = await api('GET', '/registers');
  const methods = await api('GET', '/payment-methods');
  const method = methods.find(m => m.kind === 'transfer');
  await api('POST', '/shifts', { registerId: register.id, openingFloat: '0' });
  const product = await api('POST', '/products', { kind: 'good', name: 'Producto de prueba', description: null, categoryId: null, brandId: null, saleMode: 'unit', vatRate: '21', trackStock: true, minStock: null, blockNegativeStock: false, sku: null, price: '1250.50', cost: null, barcodes: [], initialStock: '2' });
  const reference = `CSV-${stamp}`;
  const sale = await api('POST', '/sales', { clientUuid: crypto.randomUUID(), registerId: register.id, lines: [{ variantId: product.variantId, quantity: '1' }], payments: [{ paymentMethodId: method.id, amount: '1250.50', reference }], expectedTotal: '1250.50' });
  await page.goto(`${BASE}/app/rendiciones`);
  await page.getByRole('button', { name: 'Nueva rendición' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Cuenta o terminal de cobro').selectOption(method.id);
  await dialog.getByLabel('Proveedor / identificación de cuenta').fill('Mercado Pago · Prueba');
  await dialog.getByRole('button', { name: 'Crear rendición' }).click();
  await page.getByRole('heading', { name: 'Mercado Pago · Prueba', exact: true }).waitFor();
  console.log('• Importar reporte y cerrar la rendición con responsable');
  await page.getByRole('button', { name: 'Importar reporte CSV' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Archivo CSV', { exact: false }).setInputFiles({ name: 'reporte.csv', mimeType: 'text/csv', buffer: Buffer.from(`id;bruto;fee\n${reference};1250,50;25,01`) });
  await dialog.getByRole('button', { name: 'Importar y comparar' }).click();
  await page.getByRole('row', { name: new RegExp(reference) }).getByText('Confirmado', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar rendición', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Observaciones del cierre').fill('Verificado con el reporte de la cuenta');
  await dialog.getByRole('button', { name: 'Confirmar cierre' }).click();
  await page.getByText('Cerrada por Dueño Prueba', { exact: false }).waitFor();
  await shot('rendicion-cerrada');
  console.log('• Guardar y recuperar apariencia, fuente y menú superior');
  await page.goto(`${BASE}/app/apariencia`);
  await page.getByLabel('Color principal', { exact: true }).fill('#065f46');
  await page.getByLabel('Color del menú', { exact: true }).fill('#14213a');
  await page.getByLabel('Fuente', { exact: true }).selectOption('archivo');
  await page.getByLabel('Ubicación del menú', { exact: true }).selectOption('top');
  await page.getByLabel('Tamaño de texto', { exact: true }).selectOption('large');
  await page.getByRole('button', { name: 'Guardar apariencia' }).click();
  await page.getByText('Apariencia guardada para este comercio', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Administración', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Fuente', { exact: true }).inputValue(), 'archivo');
  assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '18px');
  await shot('apariencia-personalizada');
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Desborde con ancho ${width}`);
  }
  await page.getByRole('button', { name: 'Restaurar valores originales' }).click();
  await page.getByRole('button', { name: 'Guardar apariencia' }).click();
  await page.getByText('Apariencia guardada para este comercio', { exact: true }).waitFor();
  console.log('• Generar CSR de homologación sin copiar claves de otros sistemas');
  await page.goto(`${BASE}/app/facturacion`);
  await page.getByLabel('CUIT del emisor').fill('20123456786');
  await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await page.getByText('Configuración fiscal guardada', { exact: true }).waitFor();
  await page.getByText('Generar un pedido de certificado (CSR)', { exact: true }).click();
  await page.getByLabel('Razón social para el pedido').fill('Prueba de homologación');
  await page.getByRole('button', { name: 'Generar CSR', exact: true }).click();
  const csr = page.getByLabel('Pedido para copiar en ARCA');
  await csr.waitFor();
  assert.ok((await csr.inputValue()).includes('BEGIN CERTIFICATE REQUEST'));
  await shot('facturacion-csr');
  assert.equal((await page.locator('body').innerText()).includes('BEGIN PRIVATE KEY'), false);
  assert.equal((await api('GET', `/sales/${sale.id}`)).status, 'confirmed');
  assert.deepEqual(errors, []);
  console.log('E2E rendiciones, apariencia y CSR OK (sin emisión ni conexiones reales a ARCA)');
} finally { await browser.close(); }
