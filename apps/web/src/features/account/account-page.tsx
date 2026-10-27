import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema, posPinSchema, type SessionDto, updateUsernameSchema } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';

const form = z
  .object({ currentPassword: z.string().min(1, 'Obligatorio'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden' });

export function AccountPage() {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<z.input<typeof form>>({ resolver: zodResolver(form) });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => http.get<SessionDto[]>('/auth/sessions') });

  const change = useMutation({
    mutationFn: (v: z.input<typeof form>) => http.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: async () => {
      reset();
      setError(null);
      toast('Contraseña actualizada. Cerramos tus otras sesiones.');
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => http.delete(`/auth/sessions/${id}`),
    onSuccess: async () => {
      toast('Sesión cerrada');
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <>
      <PageHeader title="Mi cuenta" description={[me.user.name, me.user.username, me.user.email].filter(Boolean).join(' · ')} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Cambiar contraseña</h2>
          <form onSubmit={handleSubmit((v) => change.mutate(v))} className="space-y-4" noValidate>
            {error && <Alert>{error}</Alert>}
            <Field label="Contraseña actual" error={formState.errors.currentPassword?.message}>
              {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('currentPassword')} />}
            </Field>
            <Field label="Contraseña nueva" error={formState.errors.newPassword?.message} hint="Al menos 10 caracteres.">
              {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('newPassword')} />}
            </Field>
            <Field label="Repetir contraseña nueva" error={formState.errors.confirm?.message}>
              {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('confirm')} />}
            </Field>
            <Button type="submit" loading={change.isPending}>
              Cambiar contraseña
            </Button>
          </form>
        </Card>
        <UsernameCard />
        {me.tenant && <PinCard />}
        <Card>
          <h2 className="p-6 pb-2 font-semibold">Sesiones abiertas</h2>
          {sessions.isLoading && <Spinner />}
          {sessions.data && (
            <Table head={<><Th>Dispositivo</Th><Th>Última actividad</Th><Th /></>}>
              {sessions.data.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="max-w-xs truncate text-xs text-slate-600" title={s.userAgent ?? ''}>
                      {s.userAgent ?? 'Desconocido'}
                    </div>
                    <div className="text-xs text-slate-500">{s.ip}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(s.lastSeenAt)}</Td>
                  <Td className="text-right">
                    {s.current ? (
                      <Badge tone="green">Esta sesión</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                        Cerrar
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

/** Nombre de usuario para ingresar sin escribir el email (ADR 0010). */
function UsernameCard() {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.input<typeof updateUsernameSchema>, unknown, z.output<typeof updateUsernameSchema>>({
    resolver: zodResolver(updateUsernameSchema),
    defaultValues: { username: me.user.username ?? '' },
  });
  const save = useMutation({
    mutationFn: (v: z.output<typeof updateUsernameSchema>) => http.put('/auth/username', v),
    onSuccess: async () => {
      setError(null);
      toast('Nombre de usuario guardado');
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Card className="p-6">
      <h2 className="font-semibold">Nombre de usuario</h2>
      <p className="mt-1 text-sm text-slate-600">
        {me.user.email ? 'Podés ingresar con tu email o con este nombre de usuario.' : 'Es lo que usás para ingresar.'}
      </p>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="mt-4 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre de usuario" error={formState.errors.username?.message} hint="Letras sin acentos, números, punto, guion o guion bajo.">
          {(p) => <Input {...p} autoComplete="username" autoCapitalize="none" spellCheck={false} {...register('username')} />}
        </Field>
        <Button type="submit" loading={save.isPending}>
          Guardar usuario
        </Button>
      </form>
    </Card>
  );
}

/** PIN para autorizar en la caja (anulaciones, devoluciones y descuentos) sin dar la contraseña. */
function PinCard() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<z.input<typeof posPinSchema>>({ resolver: zodResolver(posPinSchema) });
  const save = useMutation({
    mutationFn: (v: z.input<typeof posPinSchema>) => http.post('/auth/pos-pin', v),
    onSuccess: () => {
      reset();
      setError(null);
      toast('PIN guardado');
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Card className="p-6">
      <h2 className="font-semibold">PIN para autorizar en la caja</h2>
      <p className="mt-1 text-sm text-slate-600">Con el PIN autorizás anulaciones, devoluciones o descuentos desde la caja de otra persona, si tu rol lo permite.</p>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="mt-4 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="PIN nuevo" error={formState.errors.pin?.message} hint="De 4 a 6 números.">
          {(p) => <Input {...p} type="password" inputMode="numeric" autoComplete="off" maxLength={6} {...register('pin')} />}
        </Field>
        <Field label="Tu contraseña" error={formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
        </Field>
        <Button type="submit" loading={save.isPending}>
          Guardar PIN
        </Button>
      </form>
    </Card>
  );
}
