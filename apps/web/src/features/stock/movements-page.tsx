import type { Paginated, ProductDto, StockMovementDto, StockMovementType } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime, formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';

const PAGE_SIZE = 50;

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  adjust: 'Ajuste',
  waste: 'Merma',
  expired: 'Vencimiento',
  count_adjust: 'Inventario físico',
  purchase_in: 'Compra',
  sale_out: 'Venta',
  return_in: 'Devolución',
  transfer_out: 'Envío a otra sucursal',
  transfer_in: 'Recepción de otra sucursal',
};

/** Tipos que hoy se pueden generar (las compras, ventas y transferencias llegan en otras fases). */
const FILTERABLE: StockMovementType[] = ['adjust', 'waste', 'expired', 'count_adjust'];

export function MovementsPage() {
  const can = useCan();
  const allowed = can('stock.read');
  const { productId } = useSearch({ from: '/app/stock/movimientos' });
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (productId) params.set('productId', productId);
  if (type) params.set('type', type);
  const movements = useQuery({
    queryKey: ['stock', 'movements', params.toString()],
    queryFn: () => http.get<Paginated<StockMovementDto>>(`/stock/movements?${params}`),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  const product = useQuery({
    queryKey: ['products', productId],
    queryFn: () => http.get<ProductDto>(`/products/${productId}`),
    enabled: allowed && !!productId && can('products.read'),
  });
  if (!allowed) return <Forbidden />;
  const seeCost = can('costs.read');

  return (
    <>
      <PageHeader
        title={product.data ? `Movimientos · ${product.data.name}` : 'Movimientos de stock'}
        description="Libro de entradas y salidas. Los movimientos no se editan ni se borran: un error se corrige con otro ajuste."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label="Tipo de movimiento" className="sm:w-56" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
          <option value="">Todos los tipos</option>
          {FILTERABLE.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_LABELS[t]}
            </option>
          ))}
        </Select>
        {productId && (
          <button className="text-sm text-brand-700 hover:underline" onClick={() => void navigate({ to: '/app/stock/movimientos', search: {} })}>
            Ver todos los productos
          </button>
        )}
        <Link to="/app/stock" className="text-sm text-brand-700 hover:underline">
          Volver al stock
        </Link>
      </div>
      <Card>
        {movements.isLoading && <Spinner />}
        {movements.error && <div className="p-4"><Alert>{errorMessage(movements.error)}</Alert></div>}
        {movements.data && movements.data.items.length === 0 && <EmptyState>Sin movimientos.</EmptyState>}
        {movements.data && movements.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>Fecha</Th>
                {!productId && <Th>Producto</Th>}
                <Th>Tipo</Th>
                <Th className="text-right">Cantidad</Th>
                <Th className="text-right">Saldo</Th>
                {seeCost && <Th className="text-right">Costo unit.</Th>}
                <Th>Detalle</Th>
                <Th>Usuario</Th>
              </>
            }
          >
            {movements.data.items.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap">{formatDateTime(m.occurredAt)}</Td>
                {!productId && (
                  <Td>
                    <Link to="/app/stock/movimientos" search={{ productId: m.productId }} className="font-medium hover:underline">
                      {m.productName}
                    </Link>
                  </Td>
                )}
                <Td>
                  <Badge tone={m.type === 'waste' || m.type === 'expired' ? 'red' : m.type === 'count_adjust' ? 'brand' : 'slate'}>{MOVEMENT_LABELS[m.type] ?? m.type}</Badge>
                </Td>
                <Td className={`text-right font-semibold whitespace-nowrap ${m.quantity.startsWith('-') ? 'text-red-700' : 'text-emerald-700'}`}>
                  {m.quantity.startsWith('-') ? '' : '+'}
                  {formatQty(m.quantity)}
                </Td>
                <Td className="text-right whitespace-nowrap">{formatQty(m.balanceAfter)}</Td>
                {seeCost && <Td className="text-right whitespace-nowrap text-slate-600">{m.unitCost ? formatArs(m.unitCost) : '—'}</Td>}
                <Td className="text-slate-600">{m.reason ?? '—'}</Td>
                <Td>{m.userName ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
        {movements.data && <Pager page={page} pageSize={PAGE_SIZE} total={movements.data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
