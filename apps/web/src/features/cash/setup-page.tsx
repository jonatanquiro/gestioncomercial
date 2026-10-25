import { type BranchDto, PAYMENT_KIND_LABELS, PAYMENT_KINDS, type PaymentKind, type PaymentMethodDto, paymentMethodSchema, type RegisterDto } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { paymentMethodsQuery, registersQuery } from '@/features/sales/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { useCan } from '@/lib/session';

/** Cajas de cada sucursal y medios de pago que acepta el comercio. */
export function CashSetupPage() {
  const can = useCan();
  const manageRegisters = can('branches.manage');
  const manageMethods = can('settings.manage');
  if (!manageRegisters && !manageMethods) return <Forbidden />;
  return (
    <>
      <PageHeader title="Cajas y medios de pago" description="Puntos de cobro de cada sucursal y formas de pago que aceptás." />
      <div className="grid gap-6 xl:grid-cols-2">
        {manageRegisters && <RegistersCard />}
        {manageMethods && <MethodsCard />}
      </div>
    </>
  );
}

function RegistersCard() {
  const registers = useQuery(registersQuery);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => http.get<BranchDto[]>('/branches') });
  const [editing, setEditing] = useState<RegisterDto | 'new' | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Cajas</h2>
        <Button size="sm" onClick={() => setEditing('new')}>
          Nueva caja
        </Button>
      </div>
      <Table
        head={
          <>
            <Th>Caja</Th>
            <Th>Sucursal</Th>
            <Th>Estado</Th>
            <Th />
          </>
        }
      >
        {(registers.data ?? []).map((r) => (
          <tr key={r.id}>
            <Td className="font-medium">{r.name}</Td>
            <Td>{r.branchName}</Td>
            <Td>{r.status === 'active' ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
            <Td className="text-right">
              <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                Editar
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
      {editing && <RegisterDialog register={editing === 'new' ? null : editing} branches={(branches.data ?? []).filter((b) => b.status === 'active')} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function RegisterDialog({ register, branches, onClose }: { register: RegisterDto | null; branches: BranchDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(register?.name ?? '');
  const [branchId, setBranchId] = useState(register?.branchId ?? branches[0]?.id ?? '');
  const [active, setActive] = useState(register ? register.status === 'active' : true);
  const save = useMutation({
    mutationFn: () =>
      register
        ? http.put(`/registers/${register.id}`, { name: name.trim(), status: active ? 'active' : 'inactive' })
        : http.post('/registers', { branchId, name: name.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['registers'] });
      toast(register ? 'Caja actualizada' : 'Caja creada');
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) save.mutate();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={register ? `Editar ${register.name}` : 'Nueva caja'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Nombre">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
        {!register && (
          <Field label="Sucursal">
            {(p) => (
              <Select {...p} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {register && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activa
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MethodsCard() {
  const methods = useQuery(paymentMethodsQuery);
  const [editing, setEditing] = useState<PaymentMethodDto | 'new' | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Medios de pago</h2>
        <Button size="sm" onClick={() => setEditing('new')}>
          Nuevo medio
        </Button>
      </div>
      <Table
        head={
          <>
            <Th>Nombre</Th>
            <Th>Tipo</Th>
            <Th>Estado</Th>
            <Th />
          </>
        }
      >
        {(methods.data ?? []).map((m) => (
          <tr key={m.id}>
            <Td className="font-medium">
              {m.name}
              {m.requiresReference && <span className="block text-xs text-slate-500">Pide número de operación</span>}
            </Td>
            <Td>{PAYMENT_KIND_LABELS[m.kind]}</Td>
            <Td>{m.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
            <Td className="text-right">
              <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                Editar
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
      {editing && <MethodDialog method={editing === 'new' ? null : editing} nextOrder={(methods.data?.length ?? 0) + 1} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function MethodDialog({ method, nextOrder, onClose }: { method: PaymentMethodDto | null; nextOrder: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(method?.name ?? '');
  const [kind, setKind] = useState<PaymentKind>(method?.kind ?? 'other');
  const [requiresReference, setRequiresReference] = useState(method?.requiresReference ?? false);
  const [active, setActive] = useState(method?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => (method ? http.put(`/payment-methods/${method.id}`, body) : http.post('/payment-methods', body)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
      toast(method ? 'Medio de pago actualizado' : 'Medio de pago creado');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = paymentMethodSchema.safeParse({ name, kind, requiresReference, active, sortOrder: method?.sortOrder ?? nextOrder });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
    setError(null);
    save.mutate(parsed.data);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={method ? `Editar ${method.name}` : 'Nuevo medio de pago'}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
        <Field label="Tipo" hint="Solo el efectivo entra al cajón y permite dar vuelto.">
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
              {PAYMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PAYMENT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={requiresReference} onChange={(e) => setRequiresReference(e.target.checked)} /> Pedir número de operación al cobrar
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activo
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="submit" loading={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
