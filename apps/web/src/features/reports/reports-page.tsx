import { type BranchDto, type ReportGroupBy, type SalesReportDto, type StaleReportDto } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';

const GROUPS: Array<[ReportGroupBy, string]> = [
  ['product', 'Productos'],
  ['variant', 'Talles y variantes'],
  ['category', 'Categorías'],
  ['day', 'Días'],
  ['cashier', 'Vendedores'],
  ['payment', 'Medios de pago'],
];

/** Fecha local AAAA-MM-DD. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function preset(kind: 'today' | 'week' | 'month' | 'lastMonth'): [string, string] {
  const now = new Date();
  if (kind === 'today') return [iso(now), iso(now)];
  if (kind === 'week') return [iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), iso(now)];
  if (kind === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
  return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
}

/** Descarga las filas como CSV con separador «;», como lo abre Excel en español. */
function downloadCsv(name: string, header: string[], rows: Array<Array<string | number>>) {
  const cell = (v: string | number) => {
    const text = typeof v === 'number' ? String(v) : /^-?\d+(\.\d+)?$/.test(v) ? v.replace('.', ',') : v;
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reportes (ADR 0019): qué se vendió, cuánto se ganó y qué no rota. */
export function ReportsPage() {
  const can = useCan();
  const [tab, setTab] = useState<'sales' | 'stale'>('sales');
  if (!can('reports.sales')) return <Forbidden />;
  return (
    <>
      <PageHeader title="Reportes" description="Ventas netas de devoluciones. No incluyen la venta de gift cards ni los cobros de cuenta corriente." />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ['sales', 'Ventas'],
            ['stale', 'Sin rotación'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'sales' ? <SalesReport /> : <StaleReport />}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

function SalesReport() {
  const can = useCan();
  const [[from, to], setRange] = useState(() => preset('month'));
  const [branchId, setBranchId] = useState('');
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('product');
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => http.get<BranchDto[]>('/branches') });
  const params = new URLSearchParams({ from, to, groupBy });
  if (branchId) params.set('branchId', branchId);
  const report = useQuery({ queryKey: ['reports', 'sales', params.toString()], queryFn: () => http.get<SalesReportDto>(`/reports/sales?${params}`), placeholderData: keepPreviousData, enabled: !!from && !!to });
  const data = report.data;
  const s = data?.summary;
  const quantityColumn = ['product', 'variant', 'category'].includes(groupBy);
  const countColumn = ['day', 'cashier', 'payment'].includes(groupBy);
  const profit = !!data?.profit && quantityColumn;
  const label = GROUPS.find(([k]) => k === groupBy)![1];

  function exportCsv() {
    if (!data) return;
    const header = [label, ...(quantityColumn ? ['Cantidad'] : []), ...(countColumn ? ['Operaciones'] : []), 'Total', ...(profit ? ['Costo', 'Margen'] : [])];
    const rows = data.rows.map((r) => [r.label, ...(quantityColumn ? [r.quantity ?? ''] : []), ...(countColumn ? [r.count ?? 0] : []), r.total, ...(profit ? [r.cost ?? '', r.margin ?? ''] : [])]);
    downloadCsv(`ventas-${groupBy}-${from}-a-${to}.csv`, header, rows);
  }

  return (
    <>
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['today', 'Hoy'],
              ['week', '7 días'],
              ['month', 'Este mes'],
              ['lastMonth', 'Mes pasado'],
            ] as const
          ).map(([key, text]) => (
            <Button key={key} size="sm" variant={preset(key).join() === [from, to].join() ? 'primary' : 'secondary'} onClick={() => setRange(preset(key))}>
              {text}
            </Button>
          ))}
        </div>
        <Input aria-label="Desde" type="date" className="w-44" value={from} onChange={(e) => setRange([e.target.value, to])} />
        <Input aria-label="Hasta" type="date" className="w-44" value={to} onChange={(e) => setRange([from, e.target.value])} />
        {(branches.data?.length ?? 0) > 1 && (
          <Select aria-label="Sucursal" className="w-52" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Todas las sucursales</option>
            {branches.data!.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </Card>
      {report.error && <Alert>{errorMessage(report.error)}</Alert>}
      {s && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Vendido (neto)" value={formatArs(s.net)} hint={dec(s.returns).gt(0) ? `${formatArs(s.gross)} − ${formatArs(s.returns)} devueltos` : undefined} />
          <Tile label="Ventas" value={s.count} hint={`Ticket promedio ${formatArs(s.averageTicket)}`} />
          <Tile label="Unidades" value={formatQty(s.units)} />
          {s.margin !== undefined ? (
            <Tile
              label="Ganancia bruta"
              value={formatArs(s.margin)}
              hint={`${dec(s.net).gt(0) ? `${dec(s.margin).div(s.net).times(100).toFixed(1).replace('.', ',')} % sobre lo vendido` : ''}${s.missingCost ? ` · ${s.missingCost} línea(s) sin costo` : ''}`}
            />
          ) : (
            can('reports.profit') && <Tile label="Ganancia bruta" value="—" hint="Tu plan no incluye reportes avanzados." />
          )}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Agrupar por">
            {GROUPS.map(([key, text]) => (
              <Button key={key} size="sm" variant={groupBy === key ? 'primary' : 'secondary'} aria-pressed={groupBy === key} onClick={() => setGroupBy(key)}>
                {text}
              </Button>
            ))}
          </div>
          {can('reports.export') && data && data.rows.length > 0 && (
            <Button size="sm" variant="secondary" onClick={exportCsv}>
              <Download className="size-4" /> Descargar CSV
            </Button>
          )}
        </div>
        {report.isLoading && <Spinner />}
        {data && data.rows.length === 0 && <EmptyState>No hay ventas en ese período.</EmptyState>}
        {data && data.rows.length > 0 && (
          <Table
            head={
              <>
                <Th>{label}</Th>
                {quantityColumn && <Th className="text-right">Cantidad</Th>}
                {countColumn && <Th className="text-right">Operaciones</Th>}
                <Th className="text-right">Total</Th>
                {profit && <Th className="text-right">Costo</Th>}
                {profit && <Th className="text-right">Margen</Th>}
              </>
            }
          >
            {data.rows.map((r) => (
              <tr key={r.key}>
                <Td>
                  <span className="font-medium">{groupBy === 'day' ? formatDate(`${r.label}T12:00:00`) : r.label}</span>
                  {r.detail && <span className="block text-xs text-slate-500">{r.detail}</span>}
                </Td>
                {quantityColumn && <Td className="text-right">{formatQty(r.quantity ?? '0')}</Td>}
                {countColumn && <Td className="text-right">{r.count}</Td>}
                <Td className="text-right font-semibold">{formatArs(r.total)}</Td>
                {profit && <Td className="text-right">{formatArs(r.cost ?? '0')}{r.missingCost ? ' *' : ''}</Td>}
                {profit && (
                  <Td className="text-right">
                    {formatArs(r.margin ?? '0')}
                    {dec(r.total).gt(0) && <span className="block text-xs text-slate-500">{dec(r.margin ?? '0').div(r.total).times(100).toFixed(1).replace('.', ',')} %</span>}
                  </Td>
                )}
              </tr>
            ))}
          </Table>
        )}
        {profit && data?.rows.some((r) => r.missingCost) && <p className="px-4 py-3 text-xs text-slate-500">* Hay artículos vendidos sin costo cargado: su margen aparece más alto de lo real.</p>}
      </Card>
    </>
  );
}

function StaleReport() {
  const can = useCan();
  const [days, setDays] = useState(60);
  const report = useQuery({ queryKey: ['reports', 'stale', days], queryFn: () => http.get<StaleReportDto>(`/reports/stale?days=${days}`), placeholderData: keepPreviousData });
  const data = report.data;
  const value = data?.profit ? data.rows.reduce((sum, r) => sum.plus(r.stockValue ?? '0'), dec(0)) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <label className="flex items-center gap-2 text-sm">
          Con stock y sin ventas en los últimos
          <Select aria-label="Días sin ventas" className="w-32" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {[30, 60, 90, 180].map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-center gap-3">
          {value && value.gt(0) && <span className="text-sm text-slate-600">Inmovilizado al costo: <span className="font-semibold">{formatArs(value.toFixed(2))}</span></span>}
          {can('reports.export') && data && data.rows.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadCsv(
                  `sin-rotacion-${days}-dias.csv`,
                  ['Artículo', 'Stock', 'Última venta', ...(data.profit ? ['Valor al costo'] : [])],
                  data.rows.map((r) => [r.name, r.stock, r.lastSaleAt ? formatDate(r.lastSaleAt) : 'Nunca', ...(data.profit ? [r.stockValue ?? ''] : [])]),
                )
              }
            >
              <Download className="size-4" /> Descargar CSV
            </Button>
          )}
        </div>
      </div>
      {report.isLoading && <Spinner />}
      {report.error && <Alert>{errorMessage(report.error)}</Alert>}
      {data && data.rows.length === 0 && <EmptyState>Todo lo que tiene stock se vendió en ese período.</EmptyState>}
      {data && data.rows.length > 0 && (
        <Table
          head={
            <>
              <Th>Artículo</Th>
              <Th className="text-right">Stock</Th>
              <Th>Última venta</Th>
              {data.profit && <Th className="text-right">Valor al costo</Th>}
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.variantId}>
              <Td>
<span className="font-medium">{r.name}</span>
              </Td>
              <Td className="text-right">{formatQty(r.stock)}</Td>
              <Td>{r.lastSaleAt ? formatDate(r.lastSaleAt) : 'Nunca'}</Td>
              {data.profit && <Td className="text-right">{r.stockValue ? formatArs(r.stockValue) : '—'}</Td>}
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
