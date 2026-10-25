import type { Paginated, ProductDto, ProductHistoryDto } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime, formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { ProductForm } from './product-form';
import { categoriesQuery } from './queries';

const PAGE_SIZE = 25;

const CHANGE_LABELS: Record<string, string> = {
  'product.created': 'Alta',
  'product.updated': 'Modificación',
  'product.deactivated': 'Desactivación',
  'product.activated': 'Reactivación',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre', kind: 'Tipo', description: 'Descripción', categoryId: 'Categoría', brandId: 'Marca', saleMode: 'Forma de venta',
  vatRate: 'IVA', trackStock: 'Controla stock', minStock: 'Stock mínimo', blockNegativeStock: 'Bloquea negativo', sku: 'Código interno',
  price: 'Precio', cost: 'Costo', barcodes: 'Códigos', status: 'Estado',
};

function describeChange(after: unknown): string {
  if (!after || typeof after !== 'object') return '';
  return Object.keys(after as Record<string, unknown>)
    .map((k) => FIELD_LABELS[k] ?? k)
    .join(', ');
}

function HistoryView({ product }: { product: ProductDto }) {
  const can = useCan();
  const history = useQuery({ queryKey: ['products', product.id, 'history'], queryFn: () => http.get<ProductHistoryDto>(`/products/${product.id}/history`) });
  if (history.isLoading) return <Spinner />;
  if (history.error) return <Alert>{errorMessage(history.error)}</Alert>;
  const h = history.data!;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Precios</h3>
        <Table head={<><Th>Desde</Th><Th>Hasta</Th><Th className="text-right">Precio</Th><Th>Quién</Th></>}>
          {h.prices.map((p, i) => (
            <tr key={i}>
              <Td className="whitespace-nowrap">{formatDateTime(p.validFrom)}</Td>
              <Td className="whitespace-nowrap">{p.validTo ? formatDateTime(p.validTo) : <Badge tone="green">Vigente</Badge>}</Td>
              <Td className="text-right font-medium">{formatArs(p.price)}</Td>
              <Td>
                {p.changedBy ?? '—'}
                {p.batchId && <span className="ml-1 text-xs text-slate-500">(cambio masivo)</span>}
              </Td>
            </tr>
          ))}
        </Table>
      </section>
      {can('costs.read') && h.costs.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Costos</h3>
          <Table head={<><Th>Fecha</Th><Th className="text-right">Costo</Th><Th>Quién</Th></>}>
            {h.costs.map((c, i) => (
              <tr key={i}>
                <Td className="whitespace-nowrap">{formatDateTime(c.at)}</Td>
                <Td className="text-right">{formatArs(c.cost)}</Td>
                <Td>{c.changedBy ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        </section>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Cambios en la ficha</h3>
        <Table head={<><Th>Fecha</Th><Th>Acción</Th><Th>Campos</Th><Th>Quién</Th></>}>
          {h.changes.map((c, i) => (
            <tr key={i}>
              <Td className="whitespace-nowrap">{formatDateTime(c.at)}</Td>
              <Td>{CHANGE_LABELS[c.action] ?? c.action}</Td>
              <Td>{c.action === 'product.updated' ? describeChange(c.after) : ''}</Td>
              <Td>{c.actorName ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
}

export function ProductsPage() {
  const can = useCan();
  const allowed = can('products.read');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [dialog, setDialog] = useState<{ mode: 'new' } | { mode: 'edit' | 'history'; product: ProductDto } | null>(null);
  const categories = useQuery({ ...categoriesQuery, enabled: allowed });
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status });
  if (search.trim()) params.set('q', search.trim());
  if (categoryId) params.set('categoryId', categoryId);
  const products = useQuery({
    queryKey: ['products', 'list', params.toString()],
    queryFn: () => http.get<Paginated<ProductDto>>(`/products?${params}`),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  const toggle = useMutation({
    mutationFn: (p: ProductDto) => http.post<ProductDto>(`/products/${p.id}/status`, { status: p.status === 'active' ? 'inactive' : 'active' }),
    onSuccess: async (p) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast(p.status === 'active' ? 'Producto reactivado' : 'Producto desactivado');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (!allowed) return <Forbidden />;
  const seeCost = can('costs.read');
  const seeStock = can('stock.read');

  return (
    <>
      <PageHeader
        title="Productos"
        description="Artículos y servicios que vende el comercio, con sus códigos de barras y precios."
        actions={
          <>
            {can('prices.bulk_update') && (
              <Link to="/app/precios" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50">
                Cambiar precios
              </Link>
            )}
            {can('products.create') && (
              <Button onClick={() => setDialog({ mode: 'new' })}>
                <Plus className="size-4" aria-hidden /> Nuevo producto
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Buscar por nombre, código de barras o código interno"
          placeholder="Buscar por nombre o escanear un código"
          className="sm:w-80"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select aria-label="Categoría" className="sm:w-56" value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setPage(1))}>
          <option value="">Todas las categorías</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Estado" className="sm:w-40" value={status} onChange={(e) => (setStatus(e.target.value as typeof status), setPage(1))}>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
          <option value="all">Todos</option>
        </Select>
      </div>
      <Card>
        {products.isLoading && <Spinner />}
        {products.error && <div className="p-4"><Alert>{errorMessage(products.error)}</Alert></div>}
        {products.data && products.data.items.length === 0 && (
          <EmptyState>{search || categoryId || status !== 'active' ? 'Ningún producto coincide con la búsqueda.' : 'Todavía no hay productos cargados.'}</EmptyState>
        )}
        {products.data && products.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>Producto</Th>
                <Th>Categoría</Th>
                <Th className="text-right">Precio</Th>
                {seeCost && <Th className="text-right">Costo</Th>}
                {seeStock && <Th className="text-right">Stock</Th>}
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </>
            }
          >
            {products.data.items.map((p) => {
              const low = p.stock !== null && p.minStock !== null && dec(p.stock).lte(p.minStock);
              return (
                <tr key={p.id}>
                  <Td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {[p.kind === 'service' ? 'Servicio' : null, p.brandName, p.sku, ...p.barcodes.map((b) => (b.quantityFactor === '1.000' ? b.code : `${b.code} (×${formatQty(b.quantityFactor)})`))]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </Td>
                  <Td>{p.categoryName ?? '—'}</Td>
                  <Td className="text-right font-medium whitespace-nowrap">{formatArs(p.price)}</Td>
                  {seeCost && <Td className="text-right whitespace-nowrap text-slate-600">{p.cost ? formatArs(p.cost) : '—'}</Td>}
                  {seeStock && (
                    <Td className="text-right whitespace-nowrap">
                      {p.stock === null ? <span className="text-slate-400">—</span> : <span className={low ? 'font-semibold text-orange-700' : ''}>{formatQty(p.stock, p.saleMode)}</span>}
                    </Td>
                  )}
                  <Td>{p.status === 'active' ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {can('products.update') && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ mode: 'edit', product: p })}>
                        Editar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ mode: 'history', product: p })}>
                      Historial
                    </Button>
                    {can('products.deactivate') && (
                      <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === p.id} onClick={() => toggle.mutate(p)}>
                        {p.status === 'active' ? 'Desactivar' : 'Reactivar'}
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
        {products.data && <Pager page={page} pageSize={PAGE_SIZE} total={products.data.total} onPage={setPage} />}
      </Card>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        wide
        title={dialog?.mode === 'new' ? 'Nuevo producto' : dialog?.mode === 'edit' ? 'Editar producto' : `Historial · ${dialog?.product.name ?? ''}`}
      >
        {dialog?.mode === 'new' && <ProductForm onDone={() => setDialog(null)} />}
        {dialog?.mode === 'edit' && <ProductForm key={dialog.product.id} product={dialog.product} onDone={() => setDialog(null)} />}
        {dialog?.mode === 'history' && <HistoryView product={dialog.product} />}
      </Dialog>
    </>
  );
}
