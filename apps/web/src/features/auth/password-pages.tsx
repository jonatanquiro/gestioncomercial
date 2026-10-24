import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, passwordSchema } from '@gc/contracts';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { AuthLayout } from './auth-layout';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.input<typeof forgotPasswordSchema>, unknown, z.output<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
  });
  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await http.post<{ message: string }>('/auth/forgot-password', values);
      setSent(res.message);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <AuthLayout title="Recuperar contraseña" subtitle="Te enviamos un enlace para elegir una contraseña nueva.">
      {sent ? (
        <div className="space-y-4">
          <Alert kind="success">{sent}</Alert>
          <Link to="/login" className="text-sm text-brand-700 hover:underline">
            Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" error={formState.errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" autoFocus {...register('email')} />}
          </Field>
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Enviar enlace
          </Button>
          <Link to="/login" className="block text-center text-sm text-brand-700 hover:underline">
            Volver
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

const resetForm = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden' });

export function ResetPasswordPage() {
  const { token } = useSearch({ from: '/restablecer' });
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.input<typeof resetForm>>({ resolver: zodResolver(resetForm) });
  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await http.post('/auth/reset-password', { token, password });
      await navigate({ to: '/login' });
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  if (!token) {
    return (
      <AuthLayout title="Enlace inválido">
        <Link to="/recuperar" className="text-sm text-brand-700 hover:underline">
          Pedir un enlace nuevo
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Elegir contraseña nueva" subtitle="Por seguridad, se cerrarán todas tus sesiones abiertas.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Contraseña nueva" error={formState.errors.password?.message} hint="Al menos 10 caracteres.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" autoFocus {...register('password')} />}
        </Field>
        <Field label="Repetir contraseña" error={formState.errors.confirm?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('confirm')} />}
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Guardar contraseña
        </Button>
      </form>
    </AuthLayout>
  );
}
