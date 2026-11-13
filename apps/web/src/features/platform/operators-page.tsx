import { createPlatformOperatorSchema, type PlatformOperatorDto, platformOperatorPasswordSchema } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const operatorsQuery = { queryKey: ['platform', 'operators'], queryFn: () => http.get<PlatformOperatorDto[]>('/platform/operators') };

/** Operadores del panel de plataforma (ADR 0027): alta, clave nueva y desactivar. */
export function PlatformOperatorsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const operators = useQuery(operatorsQuery);
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState<PlatformOperatorDto | null>(null);
  const status = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) => http.post(`/platform/operators/${id}/status`, { status }),
    onSuccess: (_, v) => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'operators'] });
      toast(v.status === 'active' ? 'Operador activado' : 'Operador desactivado: se cerraron sus sesiones');
    },
  });

  return (
    <>
      <PageHeader
        title="Operadores"
        description="Personas que pueden entrar a este panel: ven todos los comercios, cambian planes y actualizan la base."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nuevo operador
          </Button>
        }
      />
      {status.error && (
        <div className="mb-4">
          <Alert>{errorMessage(status.error)}</Alert>
        </div>
      )}
      <Card>
        {operators.isLoading && <Spinner />}
        {operators.error && <Alert>{errorMessage(operators.error)}</Alert>}
        {operators.data && (
          <Table
            head={
              <>
                <Th>Operador</Th>
                <Th>Última actividad</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </>
            }
          >
            {operators.data.map((o) => (
              <tr key={o.id}>
                <Td>
                  <span className="font-semibold">{o.name}</span>
                  {o.isMe && <span className="ml-2 text-xs text-slate-500">(vos)</span>}
                  <span className="block text-xs text-slate-500">{o.email}</span>
                </Td>
                <Td>{o.lastSeenAt ? formatDateTime(o.lastSeenAt) : 'Nunca entró'}</Td>
                <Td>{o.status === 'active' ? <Badge tone="green">Activo</Badge> : <Badge>Desactivado</Badge>}</Td>
                <Td className="space-x-2 text-right">
                  <Button size="sm" variant="subtle" onClick={() => setPassword(o)}>
                    Cambiar clave
                  </Button>
                  {!o.isMe && (
                    <Button size="sm" variant="ghost" loading={status.isPending && status.variables?.id === o.id} onClick={() => status.mutate({ id: o.id, status: o.status === 'active' ? 'inactive' : 'active' })}>
                      {o.status === 'active' ? 'Desactivar' : 'Activar'}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && <OperatorForm onClose={() => setCreating(false)} />}
      {password && <PasswordForm operator={password} onClose={() => setPassword(null)} />}
    </>
  );
}

function OperatorForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) => http.post<PlatformOperatorDto>('/platform/operators', body),
    onSuccess: (o) => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'operators'] });
      toast(`Operador creado: ${o.email}`);
      onClose();
    },
    onError: (err) => err instanceof ApiRequestError && setErrors(err.fieldErrors()),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createPlatformOperatorSchema.safeParse(form);
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    save.mutate(parsed.data);
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Nuevo operador" description="Entra en /plataforma/login con este email y la clave. Pasale la clave por un medio seguro.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Nombre" error={errors.name}>{(p) => <Input {...p} autoFocus maxLength={120} value={form.name} onChange={set('name')} />}</Field>
        <Field label="Email" error={errors.email}>{(p) => <Input {...p} type="email" autoComplete="off" value={form.email} onChange={set('email')} />}</Field>
        <Field label="Clave inicial" error={errors.password} hint="Mínimo 10 caracteres.">{(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Crear operador
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PasswordForm({ operator, onClose }: { operator: PlatformOperatorDto; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => http.post(`/platform/operators/${operator.id}/password`, body),
    onSuccess: () => {
      toast(operator.isMe ? 'Clave cambiada: se cerraron tus otras sesiones' : `Clave de ${operator.name} cambiada: se cerraron sus sesiones`);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiRequestError ? (err.fieldErrors().password ?? errorMessage(err)) : errorMessage(err)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = platformOperatorPasswordSchema.safeParse({ password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Clave inválida');
    setError(null);
    save.mutate(parsed.data);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Cambiar clave de ${operator.name}`} description={operator.email}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Clave nueva" error={error ?? undefined} hint="Mínimo 10 caracteres.">
          {(p) => <Input {...p} autoFocus type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Guardar clave
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
