import { bulkPriceSchema, type BulkPricePreviewDto, PRICE_RULE_LABELS, PRICE_RULE_KINDS, type PriceRuleKind } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { formatPercent, parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { brandsQuery, categoriesQuery, tenantQuery } from './queries';

const STEPS = [0, 1, 5, 10, 50, 100] as const;

const VALUE_LABEL: Record<PriceRuleKind, string> = {
  percent: 'Porcentaje (negativo para bajar)',
  fixed: 'Monto en pesos (negativo para bajar)',
  markup: 'Recargo sobre el costo (%)',
  margin: 'Margen sobre el precio (%)',
};

export function PricesPage() {
  const can = useCan();
  const allowed = can('prices.bulk_update');
  const seeCost = can('costs.read');
  const toast = useToast();
  const queryClient = useQueryClient();
  const categories = useQuery({ ...categoriesQuery, enabled: allowed });
  const brands = useQuery({ ...brandsQuery, enabled: allowed });
  const tenant = useQuery({ ...tenantQuery, enabled: allowed });
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [kind, setKind] = useState<PriceRuleKind>('percent');
  const [value, setValue] = useState('');
  const [step, setStep] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ body: unknown; result: BulkPricePreviewDto } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roundingStep = step ?? tenant.data?.settings.priceRoundingStep ?? 0;

  const generate = useMutation({
    mutationFn: async (body: unknown) => ({ body, result: await http.post<BulkPricePreviewDto>('/prices/bulk/preview', body) }),
    onSuccess: (p) => (setPreview(p), setError(null)),
    onError: (err) => setError(errorMessage(err)),
  });
  const apply = useMutation({
    mutationFn: () => http.post<{ affectedCount: number }>('/prices/bulk/apply', { ...(preview!.body as object), fingerprint: preview!.result.fingerprint }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast(r.affectedCount === 1 ? 'Se actualizó 1 precio' : `Se actualizaron ${r.affectedCount} precios`);
      setPreview(null);
      setConfirm(false);
      setValue('');
    },
    onError: (err) => (setError(errorMessage(err)), setConfirm(false)),
  });

  if (!allowed) return <Forbidden />;
  const kinds = PRICE_RULE_KINDS.filter((k) => seeCost || (k !== 'markup' && k !== 'margin'));

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = bulkPriceSchema.safeParse({
      scope: { categoryId: categoryId || null, brandId: brandId || null, productIds: null },
      rule: { kind, value: parseDecimalInput(value) },
      roundingStep,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
    generate.mutate(parsed.data);
  }
  // Cualquier cambio en los filtros invalida la vista previa: se aplica solo lo que se vio.
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPreview(null));

  return (
    <>
      <PageHeader title="Cambio masivo de precios" description="Elegí qué artículos y cómo cambian. Antes de aplicar ves el precio anterior y el nuevo de cada uno." />
      <Card className="mb-6 p-4">
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-3" noValidate>
          <Field label="Categoría">
            {(p) => (
              <Select {...p} value={categoryId} onChange={(e) => reset(setCategoryId)(e.target.value)}>
                <option value="">Todas</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Marca">
            {(p) => (
              <Select {...p} value={brandId} onChange={(e) => reset(setBrandId)(e.target.value)}>
                <option value="">Todas</option>
                {(brands.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Regla">
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => reset(setKind)(e.target.value as PriceRuleKind)}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {PRICE_RULE_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={VALUE_LABEL[kind]}>
            {(p) => <Input {...p} inputMode="decimal" value={value} onChange={(e) => reset(setValue)(e.target.value)} />}
          </Field>
          <Field label="Redondeo hacia arriba" hint="El valor inicial sale de la configuración del comercio.">
            {(p) => (
              <Select {...p} value={String(roundingStep)} onChange={(e) => reset(setStep)(Number(e.target.value))}>
                {STEPS.map((s) => (
                  <option key={s} value={s}>
                    {s === 0 ? 'Sin redondeo' : `Al múltiplo de $${s}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" loading={generate.isPending}>
              Ver vista previa
            </Button>
          </div>
        </form>
        {(kind === 'markup' || kind === 'margin') && (
          <p className="mt-3 text-xs text-slate-600">
            El recargo se calcula sobre el costo (costo $1.000 con 30% = $1.300). El margen se calcula sobre el precio de venta (costo $1.000 con 30% de margen = $1.428,57).
          </p>
        )}
      </Card>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {preview && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="text-sm">
              <span className="font-semibold">{preview.result.rows.length}</span> {preview.result.rows.length === 1 ? 'artículo cambia' : 'artículos cambian'} de precio
              {preview.result.skipped.length > 0 && <span className="text-slate-600"> · {preview.result.skipped.length} sin cambios</span>}
            </div>
            <Button disabled={preview.result.rows.length === 0} onClick={() => setConfirm(true)}>
              Aplicar cambios
            </Button>
          </div>
          {preview.result.rows.length === 0 ? (
            <EmptyState>Ningún artículo cambia de precio con esta regla.</EmptyState>
          ) : (
            <Table
              head={
                <>
                  <Th>Artículo</Th>
                  {seeCost && <Th className="text-right">Costo</Th>}
                  <Th className="text-right">Precio actual</Th>
                  <Th className="text-right">Precio nuevo</Th>
                  <Th className="text-right">Variación</Th>
                  {seeCost && <Th className="text-right">Recargo</Th>}
                  {seeCost && <Th className="text-right">Margen</Th>}
                </>
              }
            >
              {preview.result.rows.map((r) => (
                <tr key={r.variantId}>
                  <Td className="font-medium">{r.name}</Td>
                  {seeCost && <Td className="text-right text-slate-600">{r.cost ? formatArs(r.cost) : '—'}</Td>}
                  <Td className="text-right">{formatArs(r.oldPrice)}</Td>
                  <Td className="text-right font-semibold">{formatArs(r.newPrice)}</Td>
                  <Td className={`text-right ${r.variation?.startsWith('-') ? 'text-red-700' : 'text-emerald-700'}`}>{formatPercent(r.variation)}</Td>
                  {seeCost && <Td className="text-right">{formatPercent(r.markup)}</Td>}
                  {seeCost && <Td className="text-right">{formatPercent(r.margin)}</Td>}
                </tr>
              ))}
            </Table>
          )}
          {preview.result.skipped.length > 0 && (
            <details className="border-t border-slate-200 px-4 py-3 text-sm">
              <summary className="cursor-pointer text-slate-600">Artículos que no cambian ({preview.result.skipped.length})</summary>
              <ul className="mt-2 space-y-1">
                {preview.result.skipped.map((s) => (
                  <li key={s.productId}>
                    {s.name} <span className="text-slate-500">· {s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm} title="Aplicar el cambio de precios">
        <div className="space-y-4 text-sm">
          <p>
            {preview?.result.rows.length === 1 ? 'Se va a actualizar 1 precio' : `Se van a actualizar ${preview?.result.rows.length} precios`}, exactamente como en la vista previa. Si alguien cambió un precio mientras tanto, el sistema te va a
            pedir que la generes de nuevo.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Volver
            </Button>
            <Button loading={apply.isPending} onClick={() => apply.mutate()}>
              Aplicar
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
