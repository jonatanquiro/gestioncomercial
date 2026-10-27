import { zodResolver } from '@hookform/resolvers/zod';
import { TAX_CONDITION_LABELS, TAX_CONDITIONS, type TenantDto, updateTenantSchema } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatCuit, parseDecimalInput } from '@/lib/format';
import { SettingsTabs } from '@/features/settings/settings-tabs';
import { useCan } from '@/lib/session';

type FormIn = z.input<typeof updateTenantSchema>;
type FormOut = z.output<typeof updateTenantSchema>;

function SettingsForm({ tenant }: { tenant: TenantDto }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, control, formState, setError: setFieldError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(updateTenantSchema),
    defaultValues: {
      tradeName: tenant.tradeName,
      legalName: tenant.legalName ?? '',
      cuit: formatCuit(tenant.cuit),
      taxCondition: tenant.taxCondition,
      address: tenant.address ?? '',
      phone: tenant.phone ?? '',
      email: tenant.email ?? '',
      settings: { ...tenant.settings, discountLimitPercent: (tenant.settings.discountLimitPercent ?? '10').replace(/\.00$/, '') },
    },
  });
  const save = useMutation({
    mutationFn: (v: FormOut) => http.put<TenantDto>('/tenant', v),
    onSuccess: async (data) => {
      queryClient.setQueryData(['tenant'], data);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('Datos guardados');
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) {
        for (const [path, message] of Object.entries(err.fieldErrors())) setFieldError(path as keyof FormIn, { message });
      }
      setError(errorMessage(err));
    },
  });
  const e = formState.errors;
  return (
    <form
      onSubmit={handleSubmit((v) => {
        setError(null);
        save.mutate(v);
      })}
      className="space-y-6"
      noValidate
    >
      {error && <Alert>{error}</Alert>}
      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Datos del comercio</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre de fantasía" error={e.tradeName?.message}>
            {(p) => <Input {...p} {...register('tradeName')} />}
          </Field>
          <Field label="Razón social" error={e.legalName?.message}>
            {(p) => <Input {...p} {...register('legalName')} />}
          </Field>
          <Field label="CUIT" error={e.cuit?.message}>
            {(p) => <Input {...p} inputMode="numeric" {...register('cuit')} />}
          </Field>
          <Field label="Condición frente al IVA" error={e.taxCondition?.message}>
            {(p) => (
              <Select {...p} {...register('taxCondition')}>
                {TAX_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {TAX_CONDITION_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Dirección" error={e.address?.message}>
            {(p) => <Input {...p} {...register('address')} />}
          </Field>
          <Field label="Teléfono" error={e.phone?.message}>
            {(p) => <Input {...p} type="tel" {...register('phone')} />}
          </Field>
          <Field label="Email de contacto" error={e.email?.message}>
            {(p) => <Input {...p} type="email" {...register('email')} />}
          </Field>
        </div>
      </Card>
      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">Parámetros operativos</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 rounded border-slate-300" {...register('settings.allowNegativeStock')} />
          <span>
            <span className="font-medium">Permitir vender sin stock registrado</span>
            <span className="block text-slate-500">La venta no se frena si falta cargar una compra; se genera una alerta para revisar el inventario.</span>
          </span>
        </label>
        <Controller
          control={control}
          name="settings.priceRoundingStep"
          render={({ field }) => (
            <Field label="Redondeo de precios sugeridos" hint="Se usa al calcular precios desde el costo o en cambios masivos.">
              {(p) => (
                <Select {...p} value={String(field.value)} onChange={(ev) => field.onChange(Number(ev.target.value))}>
                  <option value="0">Sin redondeo</option>
                  <option value="1">Al peso</option>
                  <option value="5">A $5</option>
                  <option value="10">A $10</option>
                  <option value="50">A $50</option>
                  <option value="100">A $100</option>
                </Select>
              )}
            </Field>
          )}
        />
        <Field
          label="Descuento máximo por artículo en caja (%)"
          error={e.settings?.discountLimitPercent?.message}
          hint="Hasta este porcentaje, quien tiene el permiso de descuentos lo aplica solo. Más arriba hace falta el PIN de un encargado."
        >
          {(p) => <Input {...p} inputMode="decimal" className="max-w-40" {...register('settings.discountLimitPercent', { setValueAs: (v: string) => parseDecimalInput(v) })} />}
        </Field>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const can = useCan();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => http.get<TenantDto>('/tenant') });
  if (!can('settings.manage')) return <Forbidden />;
  return (
    <>
      <PageHeader title="Configuración" description="Datos del negocio y parámetros de funcionamiento." />
      <SettingsTabs />
      {tenant.isLoading && <Spinner />}
      {tenant.error && <Alert>{errorMessage(tenant.error)}</Alert>}
      {tenant.data && <SettingsForm tenant={tenant.data} />}
    </>
  );
}
