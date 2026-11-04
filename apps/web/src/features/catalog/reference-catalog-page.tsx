import { addReferenceProductsSchema, type Paginated, type ReferenceSearchItemDto } from '@gc/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { categoriesQuery, zodFieldErrors } from './queries';

const PAGE_SIZE = 25;

type Picked = { name: string; price: string; initialStock: string };

/**
 * Catálogo de referencia (datos abiertos de SEPA, Precios Claros): el comercio busca lo que
 * vende, tilda, pone el precio y lo agrega a sus productos de una vez.
 */
export function ReferenceCatalogPage() {
  const can = useCan();
  const allowed = can('products.create');
  const canAdjustStock = can('stock.adjust');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const categories = useQuery({ ...categoriesQuery, enabled: allowed });
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search.trim()) params.set('q', search.trim());
  const results = useQuery({
    queryKey: ['reference', 'search', params.toString()],
    queryFn: () => http.get<Paginated<ReferenceSearchItemDto>>(`/products/reference/search?${params}`),
    placeholderData: keepPreviousData,
    enabled: allowed && search.trim().length >= 2,
  });

  const codes = [...picked.keys()];
  const add = useMutation({
    mutationFn: (body: unknown) => http.post<{ created: number }>('/products/reference/add', body),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['reference'] });
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      toast(res.created === 1 ? 'Se agregó 1 producto' : `Se agregaron ${res.created} productos`);
      setPicked(new Map());
      setErrors({});
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) setErrors(err.fieldErrors());
      setError(errorMessage(err));
    },
  });

  if (!allowed) return <Forbidden />;

  function toggle(item: ReferenceSearchItemDto) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.code)) next.delete(item.code);
      else next.set(item.code, { name: item.name, price: '', initialStock: '' });
      return next;
    });
  }

  function setValue(code: string, field: 'price' | 'initialStock', value: string) {
    setPicked((prev) => new Map(prev).set(code, { ...prev.get(code)!, [field]: value }));
    setErrors(({ [`items.${codes.indexOf(code)}.${field}`]: _, ...rest }) => rest);
  }

  function submit() {
    setError(null);
    const body = {
      categoryId: categoryId || null,
      items: codes.map((code) => ({
        code,
        price: parseDecimalInput(picked.get(code)!.price),
        initialStock: canAdjustStock ? parseDecimalInput(picked.get(code)!.initialStock) || null : null,
      })),
    };
    const parsed = addReferenceProductsSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      setError('Revisá los campos marcados.');
      return;
    }
    setErrors({});
    add.mutate(parsed.data);
  }

  const priceError = (code: string) => errors[`items.${codes.indexOf(code)}.price`] ?? errors[`items.${codes.indexOf(code)}.code`];

  return (
    <>
      <PageHeader
        title="Agregar desde el catálogo"
        description="Productos con código de barras de los supermercados (datos abiertos de Precios Claros). Tildá los que vendés, cargá el precio y el stock inicial y agregalos."
        actions={
          <Link to="/app/productos" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50">
            Volver a productos
          </Link>
        }
      />
      <div className="mb-4">
        <Input
          type="search"
          aria-label="Buscar en el catálogo por nombre, marca o código"
          placeholder="Buscar por nombre, marca o código (por ejemplo: alfajor havanna)"
          className="sm:w-[28rem]"
          autoFocus
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <Card>
        {search.trim().length < 2 && <EmptyState>Escribí al menos dos letras para buscar.</EmptyState>}
        {search.trim().length >= 2 && results.isLoading && <Spinner />}
        {results.error && <div className="p-4"><Alert>{errorMessage(results.error)}</Alert></div>}
        {search.trim().length >= 2 && results.data && results.data.items.length === 0 && (
          <EmptyState>No encontramos nada con esa búsqueda. Si el catálogo está vacío, falta importarlo (ver README).</EmptyState>
        )}
        {search.trim().length >= 2 && results.data && results.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th className="w-10"><span className="sr-only">Elegir</span></Th>
                <Th>Producto</Th>
                <Th className="w-44 text-right">Tu precio</Th>
                {canAdjustStock && <Th className="w-36 text-right">Stock inicial</Th>}
              </>
            }
          >
            {results.data.items.map((item) => {
              const chosen = picked.get(item.code);
              const err = chosen ? priceError(item.code) : undefined;
              const stockError = chosen ? errors[`items.${codes.indexOf(item.code)}.initialStock`] : undefined;
              return (
                <tr key={item.code}>
                  <Td>
                    {!item.added && (
                      <input
                        type="checkbox"
                        aria-label={`Elegir ${item.name}`}
                        className="size-4 rounded border-slate-300"
                        checked={chosen !== undefined}
                        onChange={() => toggle(item)}
                      />
                    )}
                  </Td>
                  <Td>
                    <div className="font-medium">
                      {item.name} {item.added && <Badge tone="green">Ya cargado</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">{[item.brandName, item.presentation, item.code].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td className="text-right">
                    {chosen && (
                      <>
                        <Input
                          aria-label={`Precio de ${item.name}`}
                          inputMode="decimal"
                          placeholder="Precio con IVA"
                          className="text-right"
                          value={chosen.price}
                          aria-invalid={err ? true : undefined}
                          onChange={(e) => setValue(item.code, 'price', e.target.value)}
                        />
                        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
                      </>
                    )}
                  </Td>
                  {canAdjustStock && (
                    <Td className="text-right">
                      {chosen && (
                        <>
                          <Input
                            aria-label={`Stock inicial de ${item.name}`}
                            inputMode="decimal"
                            placeholder="0"
                            className="text-right"
                            value={chosen.initialStock}
                            aria-invalid={stockError ? true : undefined}
                            onChange={(e) => setValue(item.code, 'initialStock', e.target.value)}
                          />
                          {stockError && <p className="mt-1 text-xs text-red-600">{stockError}</p>}
                        </>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </Table>
        )}
        {search.trim().length >= 2 && results.data && <Pager page={page} pageSize={PAGE_SIZE} total={results.data.total} onPage={setPage} />}
      </Card>

      {codes.length > 0 && (
        <div className="sticky bottom-0 mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold">{codes.length === 1 ? '1 producto elegido' : `${codes.length} productos elegidos`}</p>
            <p className="min-w-0 flex-1 truncate text-xs text-slate-500">{codes.map((c) => picked.get(c)!.name).join(' · ')}</p>
            <Select aria-label="Categoría para los productos elegidos" className="sm:w-56" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {(categories.data ?? [])
                .filter((c) => c.status === 'active')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
            <Button variant="ghost" onClick={() => (setPicked(new Map()), setErrors({}), setError(null))}>
              Limpiar
            </Button>
            <Button loading={add.isPending} onClick={submit}>
              Agregar {codes.length === 1 ? 'producto' : `${codes.length} productos`}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Se cargan activos, por unidad y con IVA 21 %.{' '}
            {canAdjustStock
              ? 'El stock inicial es opcional y se registra como un ajuste en el depósito principal. Si lo dejás vacío, queda en 0.'
              : 'Se necesita permiso para ajustar stock para indicar una cantidad inicial; se cargan con stock 0.'}
          </p>
        </div>
      )}
    </>
  );
}
