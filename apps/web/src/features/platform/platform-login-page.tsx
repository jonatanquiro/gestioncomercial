import { zodResolver } from '@hookform/resolvers/zod';
import { platformLoginSchema } from '@gc/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { AuthLayout } from '@/features/auth/auth-layout';
import { errorMessage, http } from '@/lib/api';

type Form = z.input<typeof platformLoginSchema>;

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form, unknown, z.output<typeof platformLoginSchema>>({
    resolver: zodResolver(platformLoginSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await http.post('/platform/auth/login', values);
      queryClient.removeQueries({ queryKey: ['platform-me'] });
      await navigate({ to: '/plataforma' });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout title="Administración de la plataforma" subtitle="Acceso exclusivo para el equipo de la plataforma.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email" error={formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="username" autoFocus {...register('email')} />}
        </Field>
        <Field label="Contraseña" error={formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
        </Field>
        <Field label="Código de verificación" error={formState.errors.totp?.message} hint="Los 6 dígitos de tu app de autenticación.">
          {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...register('totp')} />}
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Ingresar
        </Button>
      </form>
    </AuthLayout>
  );
}
