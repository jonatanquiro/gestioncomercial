import { type ItemDto, type PromotionDto, promotionSchema } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { categoriesQuery, tenantQuery, zodFieldErrors } from '@/features/catalog/queries';
import { ProductPicker } from '@/features/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatDate, parseDecimalInput, toInputDecimal } from '@/lib/format';
import { useCan } from '@/lib/session';

const promotionsQuery = { queryKey: ['promotions'], queryFn: () => http.get<PromotionDto[]>('/promotions') };

/** «20 % de descuento» o «3×2». */
export const promotionRule = (p: Pick<PromotionDto, 'kind' | 'percent' | 'buyQuantity' | 'payQuantity'>) =>
  p.kind === 'percent' ? `${toInputDecimal(p.percent ?? '0').replace(/,00$/, '')} % de descuento` : `Lleva ${p.buyQuantity}, paga ${p.payQuantity}`;

const scopeLabel = (p: PromotionDto) => (p.scope === 'all' ? 'Todo el comercio' : p.scope === 'category' ? `Categoría ${p.targetName ?? ''}` : (p.targetName ?? 'Producto'));

const dateRange = (p: PromotionDto) =>
  p.startsOn && p.endsOn
    ? `Del ${formatDate(`${p.startsOn}T12:00:00`)} al ${formatDate(`${p.endsOn}T12:00:00`)}`
    : p.startsOn
      ? `Desde el ${formatDate(`${p.startsOn}T12:00:00`)}`
      : p.endsOn
        ? `Hasta el ${formatDate(`${p.endsOn}T12:00:00`)}`
        : 'Sin fecha de fin';

/** Promociones (ADR 0020): la caja las aplica sola al cobrar. */
export function PromotionsPage() {
  const can = useCan();
  const tenant = useQuery(tenantQuery);
  const promotions = useQuery({ ...promotionsQuery, enabled: can('promotions.manage') });
  const [editing, setEditing] = useState<PromotionDto | 'new' | null>(null);
  if (!can('promotions.manage')) return <Forbidden />;
  const allowed = tenant.data?.plan?.features.includes('promotions');
  return (
    <>
      <PageHeader
        title="Promociones"
        description="Se aplican solas al cobrar. Una línea recibe la promoción que más le descuenta; si tiene un descuento manual, no recibe promociones."
        actions={
          allowed && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Nueva promoción
            </Button>
          )
        }
      />
      {tenant.data && !allowed && (
        <div className="mb-4">
          <Alert kind="info">Tu plan no incluye promociones. Se habilitan desde Suscripción, con un plan que las incluya.</Alert>
        </div>
      )}
      <Card>
        {promotions.isLoading && <Spinner />}
        {promotions.error && <Alert>{errorMessage(promotions.error)}</Alert>}
        {promotions.data && promotions.data.length === 0 && <EmptyState>Todavía no hay promociones.</EmptyState>}
        {promotions.data && promotions.data.length > 0 && (
          <Table
            head={
              <>
                <Th>Promoción</Th>
                <Th>Aplica a</Th>
                <Th>Vigencia</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </>
            }
          >
            {promotions.data.map((p) => (
              <tr key={p.id}>
                <Td>
                  <span className="font-semibold">{p.name}</span>
                  <span className="block text-xs text-slate-500">{promotionRule(p)}</span>
                </Td>
                <Td>{scopeLabel(p)}</Td>
                <Td>{dateRange(p)}</Td>
                <Td>{p.current ? <Badge tone="green">Vigente</Badge> : p.status === 'inactive' ? <Badge>Pausada</Badge> : <Badge tone="amber">Fuera de fecha</Badge>}</Td>
                <Td className="text-right">
                  {allowed && (
                    <Button size="sm" variant="subtle" onClick={() => setEditing(p)}>
                      Editar
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nueva promoción' : `Editar ${editing.name}`} wide>
          <PromotionForm promotion={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        </Dialog>
      )}
    </>
  );
}

function PromotionForm({ promotion, onDone }: { promotion?: PromotionDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useQuery(categoriesQuery);
  const [form, setForm] = useState({
    name: promotion?.name ?? '',
    kind: promotion?.kind ?? ('percent' as 'percent' | 'nxm'),
    percent: promotion?.percent ? toInputDecimal(promotion.percent) : '',
    buyQuantity: String(promotion?.buyQuantity ?? 3),
    payQuantity: String(promotion?.payQuantity ?? 2),
    scope: promotion?.scope ?? ('category' as 'all' | 'category' | 'product'),
    categoryId: promotion?.categoryId ?? '',
    product: promotion?.productId ? { id: promotion.productId, name: promotion.targetName ?? '' } : null,
    startsOn: promotion?.startsOn ?? '',
    endsOn: promotion?.endsOn ?? '',
    status: promotion?.status ?? 'active',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) => (promotion ? http.put(`/promotions/${promotion.id}`, body) : http.post('/promotions', body)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['promotions'] });
      await queryClient.invalidateQueries({ queryKey: ['pos-promotions'] });
      toast(promotion ? 'Promoción actualizada' : 'Promoción creada');
      onDone();
    },
    onError: (err) => err instanceof ApiRequestError && setErrors(err.fieldErrors()),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      kind: form.kind,
      percent: form.kind === 'percent' ? parseDecimalInput(form.percent) || null : null,
      buyQuantity: form.kind === 'nxm' ? Number(form.buyQuantity) || null : null,
      payQuantity: form.kind === 'nxm' ? Number(form.payQuantity) || null : null,
      scope: form.scope,
      categoryId: form.scope === 'category' ? form.categoryId || null : null,
      productId: form.scope === 'product' ? (form.product?.id ?? null) : null,
      startsOn: form.startsOn || null,
      endsOn: form.endsOn || null,
    };
    const parsed = promotionSchema.safeParse(body);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    save.mutate(promotion ? { ...parsed.data, status: form.status } : parsed.data);
  }
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error)}</Alert>}
      <Field label="Nombre" error={errors.name} hint="Lo ve el cajero y sale en el ticket. Ej.: 20 % en remeras">
        {(p) => <Input {...p} autoFocus maxLength={80} value={form.name} onChange={set('name')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tipo">
          {(p) => (
            <Select {...p} value={form.kind} onChange={set('kind')}>
              <option value="percent">Porcentaje de descuento</option>
              <option value="nxm">Lleva N, paga M (2×1, 3×2…)</option>
            </Select>
          )}
        </Field>
        {form.kind === 'percent' ? (
          <Field label="Descuento (%)" error={errors.percent}>{(p) => <Input {...p} inputMode="decimal" value={form.percent} onChange={set('percent')} />}</Field>
        ) : (
          <>
            <Field label="Lleva" error={errors.buyQuantity}>{(p) => <Input {...p} inputMode="numeric" value={form.buyQuantity} onChange={set('buyQuantity')} />}</Field>
            <Field label="Paga" error={errors.payQuantity} hint="Las que no paga son las más baratas.">{(p) => <Input {...p} inputMode="numeric" value={form.payQuantity} onChange={set('payQuantity')} />}</Field>
          </>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Aplica a">
          {(p) => (
            <Select {...p} value={form.scope} onChange={set('scope')}>
              <option value="category">Una categoría</option>
              <option value="product">Un producto (todos sus talles y colores)</option>
              <option value="all">Todo el comercio</option>
            </Select>
          )}
        </Field>
        {form.scope === 'category' && (
          <Field label="Categoría" error={errors.categoryId}>
            {(p) => (
              <Select {...p} value={form.categoryId} onChange={set('categoryId')}>
                <option value="">Elegí…</option>
                {(categories.data ?? []).filter((c) => c.status === 'active').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {form.scope === 'product' && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Producto</p>
            {form.product ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className="font-medium">{form.product.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, product: null })}>
                  Cambiar
                </Button>
              </div>
            ) : (
              <ProductPicker onlyStock={false} onPick={(item: ItemDto) => setForm({ ...form, product: { id: item.productId, name: item.name } })} label="Buscá el producto" />
            )}
            {errors.productId && <p className="mt-1 text-sm text-red-600">{errors.productId}</p>}
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Desde" hint="Opcional.">{(p) => <Input {...p} type="date" value={form.startsOn} onChange={set('startsOn')} />}</Field>
        <Field label="Hasta" error={errors.endsOn} hint="Opcional; incluye ese día.">{(p) => <Input {...p} type="date" value={form.endsOn} onChange={set('endsOn')} />}</Field>
        {promotion && (
          <Field label="Estado">
            {(p) => (
              <Select {...p} value={form.status} onChange={set('status')}>
                <option value="active">Activa</option>
                <option value="inactive">Pausada</option>
              </Select>
            )}
          </Field>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {promotion ? 'Guardar cambios' : 'Crear promoción'}
        </Button>
      </div>
    </form>
  );
}
