// Prueba de punta a punta de productos e inventario (Fase 3) contra una instancia real.
// Uso: E2E_BASE_URL=http://localhost:8000 node e2e/inventario.e2e.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8000';
const SHOTS = process.env.E2E_SCREENSHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now();
const owner = { name: 'Dueño Inventario', email: `inventario.${stamp}@example.com`, password: 'Kiosco-Stock-2026' };
const barcode = `779${String(stamp).slice(-10)}`;
const packCode = `1${barcode}`;

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const step = (name) => console.log(`• ${name}`);
const dialog = () => page.getByRole('dialog');

try {
  step('Registro de un kiosco');
  await page.goto(`${BASE}/registro`);
  await page.getByLabel('Nombre del comercio').fill(`Kiosco Stock ${stamp}`);
  await page.getByLabel('Rubro').selectOption({ label: 'Kiosco' });
  await page.getByLabel('Tu nombre').fill(owner.name);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Contraseña').fill(owner.password);
  await page.getByRole('button', { name: 'Crear mi comercio' }).click();
  await page.waitForURL(`${BASE}/app`);

  step('Las categorías iniciales salen del rubro');
  if (await page.getByRole('button', { name: 'Catálogo', exact: true }).isVisible()) await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await page.getByRole('link', { name: 'Categorías y marcas' }).click();
  await page.getByRole('cell', { name: 'Golosinas' }).waitFor();
  await page.getByRole('cell', { name: 'Cigarrillos' }).waitFor();

  step('Alta de producto con código de unidad, código de pack y stock inicial');
  if (await page.getByRole('button', { name: 'Catálogo', exact: true }).isVisible()) await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await page.getByRole('link', { name: 'Productos', exact: true }).click();
  await page.getByText('Todavía no hay productos cargados.').waitFor();
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await dialog().getByLabel('Nombre').fill('Alfajor de chocolate');
  await dialog().getByLabel('Categoría').selectOption({ label: 'Golosinas' });
  await dialog().getByLabel('Precio de venta (con IVA)').fill('1.250');
  await dialog().getByLabel('Costo').fill('800');
  await dialog().getByText('Recargo sobre el costo 56,25 %').waitFor();
  await dialog().getByLabel('Código 1', { exact: true }).fill(barcode);
  await dialog().getByRole('button', { name: 'Agregar código' }).click();
  await dialog().getByLabel('Código 2', { exact: true }).fill(packCode);
  await dialog().getByLabel('Unidades del código 2').fill('12');
  await dialog().getByLabel('Stock mínimo').fill('5');
  await dialog().getByLabel('Stock inicial').fill('10');
  await shot('10-alta-producto');
  await dialog().getByRole('button', { name: 'Crear producto' }).click();
  await page.getByRole('cell', { name: /^Alfajor de chocolate/ }).waitFor();
  await page.getByRole('cell', { name: '$ 1.250,00' }).waitFor();

  step('Un código repetido se rechaza con el nombre del producto que lo tiene');
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await dialog().getByLabel('Nombre').fill('Otro alfajor');
  await dialog().getByLabel('Precio de venta (con IVA)').fill('900');
  await dialog().getByLabel('Código 1', { exact: true }).fill(barcode);
  await dialog().getByRole('button', { name: 'Crear producto' }).click();
  await dialog().getByText(`El código ${barcode} ya está cargado en Alfajor de chocolate`).waitFor();
  await page.keyboard.press('Escape');

  step('Búsqueda por código de barras');
  await page.getByLabel('Buscar por nombre, código de barras o código interno').fill(packCode);
  await page.getByRole('cell', { name: /^Alfajor de chocolate/ }).waitFor();
  await shot('11-productos');

  step('Ajuste de stock con motivo');
  if (await page.getByRole('button', { name: 'Inventario', exact: true }).isVisible()) await page.getByRole('button', { name: 'Inventario', exact: true }).click();
  await page.getByRole('link', { name: 'Stock', exact: true }).click();
  const row = page.getByRole('row', { name: /Alfajor de chocolate/ });
  await row.getByText('10', { exact: true }).waitFor();
  await row.getByRole('button', { name: 'Ajustar' }).click();
  await dialog().getByLabel('Cantidad contada').fill('8');
  await dialog().getByText('Queda en 8').waitFor();
  await dialog().getByRole('button', { name: 'Ajustar stock' }).click();
  await dialog().getByText('Obligatorio').waitFor();
  await dialog().getByLabel('Detalle').fill('Conteo de góndola');
  await dialog().getByRole('button', { name: 'Ajustar stock' }).click();
  await row.getByText('8', { exact: true }).waitFor();

  step('Baja por merma');
  await row.getByRole('button', { name: /Más acciones de/ }).click();
  await row.getByRole('menuitem', { name: 'Merma o vencido' }).click();
  await dialog().getByLabel('Cantidad que se da de baja').fill('4');
  await dialog().getByLabel('Detalle').fill('Se aplastaron');
  await dialog().getByRole('button', { name: 'Registrar merma o vencido' }).click();
  await row.getByText('Bajo mínimo').waitFor();
  await shot('12-stock');

  step('Historial de movimientos');
  await row.getByRole('button', { name: /Más acciones de/ }).click();
  await row.getByRole('menuitem', { name: 'Ver movimientos' }).click();
  await page.getByRole('heading', { name: 'Movimientos · Alfajor de chocolate' }).waitFor();
  await page.getByRole('cell', { name: 'Se aplastaron' }).waitFor();
  await page.getByRole('cell', { name: 'Conteo de góndola' }).waitFor();
  await page.getByRole('cell', { name: 'Stock inicial' }).waitFor();
  await shot('13-movimientos');

  step('Inventario físico: se escanea el pack y se corrige la cantidad');
  if (await page.getByRole('button', { name: 'Inventario', exact: true }).isVisible()) await page.getByRole('button', { name: 'Inventario', exact: true }).click();
  await page.getByRole('link', { name: 'Inventario físico' }).click();
  await page.getByRole('button', { name: 'Nuevo recuento' }).click();
  await dialog().getByLabel('Nota').fill('Golosinas');
  await dialog().getByRole('button', { name: 'Empezar recuento' }).click();
  await page.getByRole('heading', { name: /Recuento parcial/ }).waitFor();
  const scanner = page.getByLabel('Escaneá o buscá el artículo que estás contando');
  await scanner.fill(packCode);
  await scanner.press('Enter');
  const countRow = page.getByRole('row', { name: /Alfajor de chocolate/ });
  await countRow.getByText('+8').waitFor();
  await countRow.getByLabel('Cantidad contada de Alfajor de chocolate').fill('6');
  await countRow.getByLabel('Cantidad contada de Alfajor de chocolate').press('Enter');
  await countRow.getByText('+2').waitFor();
  await shot('14-recuento');
  await page.getByRole('button', { name: 'Cerrar y corregir stock' }).click();
  await dialog().getByRole('button', { name: 'Cerrar y corregir' }).click();
  await page.getByText('Cerrado', { exact: true }).waitFor();

  step('Cambio masivo de precios con vista previa');
  if (await page.getByRole('button', { name: 'Catálogo', exact: true }).isVisible()) await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await page.getByRole('link', { name: 'Cambio de precios' }).click();
  await page.getByLabel('Regla').selectOption({ label: 'Margen sobre el precio de venta' });
  await page.getByLabel('Margen sobre el precio (%)').fill('30');
  await page.getByLabel('Redondeo hacia arriba').selectOption({ label: 'Al múltiplo de $10' });
  await page.getByRole('button', { name: 'Ver vista previa' }).click();
  const priceRow = page.getByRole('row', { name: /Alfajor de chocolate/ });
  await priceRow.getByText('$ 1.150,00').waitFor();
  await shot('15-precios');
  await page.getByRole('button', { name: 'Aplicar cambios' }).click();
  await dialog().getByRole('button', { name: 'Aplicar' }).click();
  await page.getByText('Se actualizó 1 precio').waitFor();

  if (await page.getByRole('button', { name: 'Catálogo', exact: true }).isVisible()) await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await page.getByRole('link', { name: 'Productos', exact: true }).click();
  const product = page.getByRole('row', { name: /Alfajor de chocolate/ });
  await product.getByRole('cell', { name: '$ 1.150,00' }).waitFor();
  await product.getByText('6', { exact: true }).waitFor();

  assert.deepEqual(errors, [], `errores de JavaScript en la página: ${errors.join('; ')}`);
  console.log('E2E de inventario OK');
} catch (err) {
  await shot('error-inventario');
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
