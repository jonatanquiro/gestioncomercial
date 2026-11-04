import { MAX_IMPORT_ROWS, type ProductImportReportDto, productImportSchema } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { useCan } from '@/lib/session';
import { readSpreadsheet, SpreadsheetError, writeXlsx, type SheetRow } from '@/lib/xlsx';
import { buildRows, businessSaleModes, chunkRows, type ColumnMap, IMPORT_FIELDS, type ImportField, mapColumns, templateSheets, usesVariants } from './import-model';
import { tenantQuery } from './queries';

const FIELD_LABELS: Record<ImportField, string> = {
  name: 'Nombre', barcode: 'Código de barras', sku: 'Código interno', price: 'Precio', cost: 'Costo', initialStock: 'Stock inicial',
  minStock: 'Stock mínimo', category: 'Categoría', brand: 'Marca', vatRate: 'IVA', saleMode: 'Se vende por', description: 'Descripción',
};

const ACTIONS: Record<ProductImportReportDto['rows'][number]['action'], { label: string; tone: 'green' | 'amber' | 'red' | undefined }> = {
  create: { label: 'Nuevo', tone: 'green' },
  update: { label: 'Cambia precio', tone: 'amber' },
  unchanged: { label: 'Sin cambios', tone: undefined },
  skip: { label: 'Ya existe', tone: undefined },
  error: { label: 'Error', tone: 'red' },
};

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Importar productos desde una planilla (ADR 0022): modelo según el rubro, vista previa y carga por partes. */
export function ImportProductsPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const tenant = useQuery(tenantQuery);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; rows: SheetRow[]; map: ColumnMap } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [report, setReport] = useState<ProductImportReportDto | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ products: number; variants: number; updated: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  if (!can('products.create')) return <Forbidden />;
  if (!tenant.data) return <Spinner />;
  const withVariants = usesVariants(tenant.data);
  const variantsAllowed = !!tenant.data.plan?.features.includes('variants');

  async function template(variants: boolean) {
    download(await writeXlsx(templateSheets(variants, businessSaleModes(tenant.data!))), variants ? 'productos-con-variantes.xlsx' : 'productos.xlsx');
  }

  /** Arma el pedido con las columnas elegidas; null si falta algo esencial. */
  function payload(current: NonNullable<typeof file>, dryRun: boolean, update = updateExisting) {
    const built = buildRows(current.rows, current.map);
    return productImportSchema.safeParse({ ...built, updateExisting: update, dryRun });
  }

  async function check(current: NonNullable<typeof file>, update = updateExisting) {
    setReport(null);
    setImportError(null);
    if (current.map.fields.name === undefined || current.map.fields.price === undefined) {
      return setImportError(`No encontré la columna ${current.map.fields.name === undefined ? '«Nombre»' : '«Precio»'} en la primera fila. Usá la planilla modelo o renombrá la columna.`);
    }
    const parsed = payload(current, true, update);
    if (!parsed.success) return setImportError(parsed.error.issues[0]?.message ?? 'Revisá la planilla');
    setChecking(true);
    try {
      setReport(await http.post<ProductImportReportDto>('/products/import', parsed.data));
    } catch (err) {
      setImportError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setReadError(null);
    setReport(null);
    setResult(null);
    setFile(null);
    try {
      const rows = await readSpreadsheet(f);
      const mapped = mapColumns(rows, variantsAllowed);
      if (!mapped || rows.length < 2) return setReadError('La planilla no tiene filas con datos debajo de los encabezados.');
      if (rows.length - 1 > MAX_IMPORT_ROWS) return setReadError(`La planilla tiene ${rows.length - 1} filas: se importan hasta ${MAX_IMPORT_ROWS} por vez. Dividila en partes.`);
      const current = { name: f.name, rows, map: mapped.map };
      setFile(current);
      await check(current);
    } catch (err) {
      setReadError(err instanceof SpreadsheetError ? err.message : 'No pude leer el archivo: subí un .xlsx o un .csv');
    }
  }

  function toggleOption(index: number, asOption: boolean) {
    if (!file) return;
    const next = { ...file, map: { ...file.map, extra: file.map.extra.map((e) => (e.index === index ? { ...e, asOption } : e)) } };
    setFile(next);
    void check(next);
  }

  async function runImport() {
    if (!file) return;
    const parsed = payload(file, false);
    if (!parsed.success) return;
    const chunks = chunkRows(parsed.data.rows as never);
    const totals = { products: 0, variants: 0, updated: 0 };
    setImportError(null);
    setProgress({ done: 0, total: parsed.data.rows.length });
    let done = 0;
    for (const rows of chunks) {
      try {
        const r = await http.post<ProductImportReportDto>('/products/import', { ...parsed.data, rows });
        totals.products += r.summary.products;
        totals.variants += r.summary.variants;
        totals.updated += r.summary.updated;
      } catch (err) {
        if (!(err instanceof ApiRequestError && err.code === 'NOTHING_TO_IMPORT')) {
          setProgress(null);
          const first = (rows[0] as { row: number }).row;
          setImportError(
            `${errorMessage(err)}. ${done > 0 ? `Se importaron las filas anteriores a la ${first}: si volvés a subir la planilla, lo que ya tiene código se detecta como existente.` : 'No se importó nada.'}`,
          );
          if (totals.products + totals.updated > 0) setResult(totals);
          return;
        }
      }
      done += rows.length;
      setProgress({ done, total: parsed.data.rows.length });
    }
    setProgress(null);
    setResult(totals);
    setReport(null);
    setFile(null);
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
  }

  const s = report?.summary;
  const options = file?.map.extra.filter((e) => e.asOption) ?? [];
  const ready = !!report && report.errors.length === 0 && (report.summary.variants > 0 || report.summary.updated > 0);

  return (
    <>
      <PageHeader title="Importar productos" description="Cargá muchos artículos de una vez desde una planilla de Excel o un CSV." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-sm text-brand-800">1</span> Descargá la planilla modelo
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {withVariants
              ? 'Viene con columnas de talle y color: una fila por combinación, con el mismo nombre.'
              : 'Una fila por artículo. Solo el nombre y el precio son obligatorios.'}{' '}
            Trae una hoja de ejemplo y las instrucciones.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void template(withVariants)}>
              <Download className="size-4" /> Planilla modelo{withVariants ? ' con talles y colores' : ''}
            </Button>
            {variantsAllowed && (
              <Button variant="ghost" onClick={() => void template(!withVariants)}>
                {withVariants ? 'Sin variantes' : 'Con talles y colores'}
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">¿Ya tenés una lista de otro sistema o del proveedor? Subila directo: se reconocen columnas como «Producto», «EAN», «PVP» o «Rubro».</p>
        </Card>
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-sm text-brand-800">2</span> Subí la planilla completa
          </h2>
          <p className="mt-2 text-sm text-slate-600">Primero vas a ver qué se carga y qué errores hay, fila por fila. No se importa nada hasta que confirmes.</p>
          <input ref={fileInput} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" aria-label="Archivo de la planilla" onChange={(e) => void onFile(e)} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => fileInput.current?.click()} loading={checking}>
              <Upload className="size-4" /> {file ? 'Subir otra planilla' : 'Elegir archivo'}
            </Button>
            {file && (
              <span className="flex items-center gap-1.5 text-sm text-slate-600">
                <FileSpreadsheet className="size-4" /> {file.name} · {file.rows.length - 1} filas
              </span>
            )}
          </div>
          {readError && (
            <div className="mt-3">
              <Alert>{readError}</Alert>
            </div>
          )}
        </Card>
      </div>

      {result && (
        <div className="mt-4">
          <Alert kind="success">
            Listo: {result.products > 0 && `se crearon ${result.products} producto(s) (${result.variants} artículo(s) con sus variantes)`}
            {result.products > 0 && result.updated > 0 && ' y '}
            {result.updated > 0 && `se actualizó el precio de ${result.updated}`}.{' '}
            <Link to="/app/productos" className="font-semibold underline">
              Ver productos
            </Link>
          </Alert>
        </div>
      )}
      {importError && (
        <div className="mt-4">
          <Alert>{importError}</Alert>
        </div>
      )}

      {file && (
        <Card className="mt-4 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-sm text-brand-800">3</span> Revisá y confirmá
          </h2>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-slate-500">Columnas reconocidas: </span>
              {IMPORT_FIELDS.filter((f) => file.map.fields[f] !== undefined)
                .map((f) => FIELD_LABELS[f])
                .join(', ')}
            </span>
          </div>
          {file.map.extra.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {file.map.extra.map((e) => (
                <label key={e.index} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
                  <span className="font-medium">«{e.header}»</span>
                  <Select aria-label={`Uso de la columna ${e.header}`} className="h-9 w-72" value={e.asOption ? 'option' : 'ignore'} onChange={(ev) => toggleOption(e.index, ev.target.value === 'option')}>
                    <option value="ignore">No se usa</option>
                    <option value="option" disabled={!variantsAllowed || (!e.asOption && options.length >= 3)}>
                      Propiedad de variantes{variantsAllowed ? '' : ' (no incluida en tu plan)'}
                    </option>
                  </Select>
                </label>
              ))}
            </div>
          )}
          {can('products.update') && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={updateExisting}
                onChange={(e) => {
                  setUpdateExisting(e.target.checked);
                  void check(file, e.target.checked);
                }}
              />
              Si el código de barras o el código interno ya está cargado, actualizar su precio y costo
            </label>
          )}

          {checking && <Spinner label="Revisando la planilla…" />}
          {report && s && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label="Productos nuevos" value={s.products} hint={s.variants !== s.products ? `${s.variants} artículos con sus variantes` : undefined} />
                <Tile label="Cambian de precio" value={s.updated} />
                <Tile label="Ya existen" value={s.skipped + s.unchanged} hint={s.skipped > 0 ? 'No se modifican' : s.unchanged > 0 ? 'Mismo precio' : undefined} />
                <Tile label="Errores" value={s.errors} danger={s.errors > 0} />
              </div>
              {(report.newCategories.length > 0 || report.newBrands.length > 0) && (
                <p className="text-sm text-slate-600">
                  {report.newCategories.length > 0 && <>Se crean las categorías: <span className="font-semibold">{report.newCategories.join(', ')}</span>. </>}
                  {report.newBrands.length > 0 && <>Se crean las marcas: <span className="font-semibold">{report.newBrands.join(', ')}</span>.</>}
                </p>
              )}
              {report.warnings.map((w) => (
                <Alert key={w} kind="info">
                  {w}
                </Alert>
              ))}
              {report.errors.length > 0 && (
                <div className="rounded-xl border border-red-200">
                  <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800">Corregí estos errores en la planilla y volvé a subirla</p>
                  <Table head={<><Th className="w-24">Fila</Th><Th>Problema</Th></>}>
                    {report.errors.slice(0, 200).map((e, i) => (
                      <tr key={i}>
                        <Td className="font-semibold">{e.row ?? '—'}</Td>
                        <Td>{e.message}</Td>
                      </tr>
                    ))}
                  </Table>
                  {report.errors.length > 200 && <p className="px-4 py-2 text-sm text-slate-500">Y {report.errors.length - 200} errores más.</p>}
                </div>
              )}
              <Table
                head={
                  <>
                    <Th className="w-20">Fila</Th>
                    <Th>Artículo</Th>
                    <Th>Qué pasa</Th>
                    <Th className="text-right">Precio</Th>
                  </>
                }
              >
                {report.rows.slice(0, 300).map((r) => (
                  <tr key={r.row}>
                    <Td className="text-slate-500">{r.row}</Td>
                    <Td>
                      <span className="font-medium">{r.name || '—'}</span>
                      {r.variant && <span className="text-slate-500"> · {r.variant}</span>}
                    </Td>
                    <Td>
                      <Badge tone={ACTIONS[r.action].tone}>{ACTIONS[r.action].label}</Badge>
                      {r.detail && <span className="ml-2 text-xs text-slate-500">{r.detail}</span>}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {r.action === 'update' && r.oldPrice && r.price !== r.oldPrice ? (
                        <>
                          <span className="text-slate-400 line-through">{formatArs(r.oldPrice)}</span> {formatArs(r.price!)}
                        </>
                      ) : r.price ? (
                        formatArs(r.price)
                      ) : (
                        ''
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
              {report.rows.length > 300 && <p className="text-sm text-slate-500">Se muestran las primeras 300 filas de {report.rows.length}.</p>}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {progress && (
                  <span className="text-sm text-slate-600">
                    Importando… {progress.done} de {progress.total} filas
                  </span>
                )}
                <Button className="h-12" disabled={!ready} loading={!!progress} onClick={() => void runImport()}>
                  <CheckCircle2 className="size-4" />
                  {s.variants > 0 ? `Importar ${s.products} producto(s)` : 'Actualizar precios'}
                  {s.variants > 0 && s.updated > 0 ? ` y actualizar ${s.updated} precio(s)` : ''}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function Tile({ label, value, hint, danger }: { label: string; value: number; hint?: string; danger?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${danger ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}>
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`font-display text-2xl font-bold tabular-nums ${danger ? 'text-red-700' : ''}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
