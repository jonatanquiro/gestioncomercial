import { PLAN_FEATURES, PLAN_LIMIT_KEYS, type PlanDto, type UpdatePlanInput, updatePlanSchema } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';

const LIMIT_LABELS: Record<(typeof PLAN_LIMIT_KEYS)[number], string> = {
  max_branches: 'Sucursales',
  max_users: 'Usuarios',
  max_products: 'Productos',
  max_registers: 'Cajas',
};

const FEATURE_LABELS: Record<(typeof PLAN_FEATURES)[number], string> = {
  multi_branch: 'Multisucursal',
  fiscal_arca: 'Factura electrónica ARCA',
  advanced_reports: 'Reportes avanzados',
  offline_pos: 'Venta sin conexión',
  promotions: 'Promociones',
  variants: 'Variantes de producto',
};

type FormIn = z.input<typeof updatePlanSchema>;

function PlanForm({ plan, onDone }: { plan: PlanDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { register, handleSubmit, formState } = useForm<FormIn, unknown, UpdatePlanInput>({
    resolver: zodResolver(updatePlanSchema),
    defaultValues: {
      name: plan.name,
      price: plan.price,
      trialDays: plan.trialDays,
      active: plan.active,
      limits: Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, plan.limits[k] ?? 0])),
      features: plan.features as UpdatePlanInput['features'],
    },
  });
  const save = useMutation({
    mutationFn: (v: UpdatePlanInput) => http.put(`/platform/plans/${plan.id}`, v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-plans'] });
      toast('Plan actualizado');
      onDone();
    },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre" error={formState.errors.name?.message}>
          {(p) => <Input {...p} {...register('name')} />}
        </Field>
        <Field label="Precio mensual (ARS)" error={formState.errors.price?.message}>
          {(p) => <Input {...p} inputMode="decimal" {...register('price')} />}
        </Field>
        <Field label="Días de prueba" error={formState.errors.trialDays?.message}>
          {(p) => <Input {...p} type="number" min={0} {...register('trialDays', { valueAsNumber: true })} />}
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Límites</legend>
        <div className="grid gap-4 sm:grid-cols-4">
          {PLAN_LIMIT_KEYS.map((k) => (
            <Field key={k} label={LIMIT_LABELS[k]} error={formState.errors.limits?.[k]?.message}>
              {(p) => <Input {...p} type="number" min={0} {...register(`limits.${k}`, { valueAsNumber: true })} />}
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Funciones incluidas</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLAN_FEATURES.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input type="checkbox" value={f} className="size-4 rounded border-slate-300" {...register('features')} />
              {FEATURE_LABELS[f]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 rounded border-slate-300" {...register('active')} />
        Disponible para nuevas altas
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={save.isPending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

export function PlatformPlansPage() {
  const [editing, setEditing] = useState<PlanDto | null>(null);
  const query = useQuery({ queryKey: ['platform-plans'], queryFn: () => http.get<PlanDto[]>('/platform/plans') });

  return (
    <>
      <PageHeader title="Planes" description="Los límites se aplican al crear sucursales y usuarios en cada comercio." />
      <Card>
        {query.isLoading && <Spinner />}
        {query.error && (
          <div className="p-4">
            <Alert>{errorMessage(query.error)}</Alert>
          </div>
        )}
        {query.data && (
          <Table
            head={
              <>
                <Th>Plan</Th>
                <Th>Precio</Th>
                <Th>Límites</Th>
                <Th>Funciones</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </>
            }
          >
            {query.data.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.trialDays} días de prueba</div>
                </Td>
                <Td className="whitespace-nowrap">{formatArs(p.price)}</Td>
                <Td className="text-slate-600">
                  {PLAN_LIMIT_KEYS.filter((k) => p.limits[k] !== undefined)
                    .map((k) => `${LIMIT_LABELS[k]}: ${p.limits[k]}`)
                    .join(' · ')}
                </Td>
                <Td className="text-slate-600">
                  {p.features.map((f) => FEATURE_LABELS[f as keyof typeof FEATURE_LABELS] ?? f).join(', ') || '—'}
                </Td>
                <Td>{p.active ? <Badge tone="green">Disponible</Badge> : <Badge>Discontinuado</Badge>}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                    Editar
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={`Editar plan ${editing?.name ?? ''}`} wide>
        {editing && <PlanForm plan={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}
