import { zodResolver } from '@hookform/resolvers/zod';
import { type BusinessTypeDto, registerTenantSchema, TAX_CONDITION_LABELS, TAX_CONDITIONS } from '@gc/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { AuthLayout } from './auth-layout';

type FormIn = z.input<typeof registerTenantSchema>;
type FormOut = z.output<typeof registerTenantSchema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const types = useQuery({ queryKey: ['business-types'], queryFn: () => http.get<BusinessTypeDto[]>('/business-types') });
  const { register, handleSubmit, formState, setError: setFieldError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(registerTenantSchema),
    defaultValues: { taxCondition: 'monotributo', businessTypeCode: '' },
  });
  const e = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await http.post('/auth/register', values);
      queryClient.clear();
      await navigate({ to: '/app' });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        for (const [path, message] of Object.entries(err.fieldErrors())) setFieldError(path as keyof FormIn, { message });
      }
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout title="Registrar mi comercio" subtitle="Creá tu espacio. Empezás con un período de prueba sin cargo.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre del comercio" error={e.tradeName?.message}>
          {(p) => <Input {...p} autoFocus {...register('tradeName')} />}
        </Field>
        <Field label="Rubro" error={e.businessTypeCode?.message} hint="Define categorías y configuraciones iniciales. Podés cambiarlas después.">
          {(p) => (
            <Select {...p} {...register('businessTypeCode')} disabled={types.isLoading}>
              <option value="">{types.isLoading ? 'Cargando…' : 'Elegí un rubro'}</option>
              {types.data?.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="CUIT (opcional)" error={e.cuit?.message}>
            {(p) => <Input {...p} inputMode="numeric" placeholder="20-12345678-6" {...register('cuit')} />}
          </Field>
        </div>
        <hr className="border-slate-200" />
        <Field label="Tu nombre" error={e.ownerName?.message}>
          {(p) => <Input {...p} autoComplete="name" {...register('ownerName')} />}
        </Field>
        <Field label="Email" error={e.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label="Contraseña" error={e.password?.message} hint="Al menos 10 caracteres.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Crear mi comercio
        </Button>
        <p className="text-center text-sm">
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" className="text-brand-700 hover:underline">
            Iniciá sesión
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
