import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@gc/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { AuthLayout } from './auth-layout';

type Form = z.input<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form, unknown, z.output<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await http.post('/auth/login', values);
      queryClient.clear();
      await navigate({ to: '/app' });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout title="Iniciar sesión" subtitle="Ingresá con tu email o nombre de usuario y tu contraseña.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email o usuario" error={formState.errors.login?.message}>
          {(p) => <Input {...p} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus {...register('login')} />}
        </Field>
        <Field label="Contraseña" error={formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Ingresar
        </Button>
        <div className="flex justify-between text-sm">
          <Link to="/recuperar" className="text-brand-700 hover:underline">
            Olvidé mi contraseña
          </Link>
          <Link to="/registro" className="text-brand-700 hover:underline">
            Registrar mi comercio
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
