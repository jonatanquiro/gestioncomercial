import { zodResolver } from '@hookform/resolvers/zod';
import { type BranchDto, updateBranchSchema } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useCan } from '@/lib/session';

type FormIn = z.input<typeof updateBranchSchema>;
type FormOut = z.output<typeof updateBranchSchema>;

function BranchForm({ branch, onDone }: { branch: BranchDto | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(updateBranchSchema),
    defaultValues: { name: branch?.name ?? '', address: branch?.address ?? '', status: branch?.status ?? 'active' },
  });
  const save = useMutation({
    mutationFn: (v: FormOut) =>
      branch ? http.put(`/branches/${branch.id}`, v) : http.post('/branches', { name: v.name, address: v.address }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      await queryClient.invalidateQueries({ queryKey: ['tenant'] });
      toast(branch ? 'Sucursal actualizada' : 'Sucursal creada');
      onDone();
    },
    onError: (err) =>
      setError(err instanceof ApiRequestError && err.code === 'PLAN_LIMIT_REACHED' ? 'Tu plan no permite más sucursales activas.' : errorMessage(err)),
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Nombre" error={formState.errors.name?.message}>
        {(p) => <Input {...p} autoFocus {...register('name')} />}
      </Field>
      <Field label="Dirección" error={formState.errors.address?.message}>
        {(p) => <Input {...p} {...register('address')} />}
      </Field>
      {branch && (
        <Field label="Estado">
          {(p) => (
            <Select {...p} {...register('status')}>
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
            </Select>
          )}
        </Field>
      )}
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

export function BranchesPage() {
  const can = useCan();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => http.get<BranchDto[]>('/branches') });
  const [editing, setEditing] = useState<BranchDto | 'new' | null>(null);
  const canManage = can('branches.manage');

  return (
    <>
      <PageHeader
        title="Sucursales"
        description="Cada sucursal tiene su depósito, sus cajas y su personal."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Nueva sucursal
            </Button>
          )
        }
      />
      <Card>
        {branches.isLoading && <Spinner />}
        {branches.error && <div className="p-4"><Alert>{errorMessage(branches.error)}</Alert></div>}
        {branches.data && branches.data.length === 0 && <EmptyState>No hay sucursales.</EmptyState>}
        {branches.data && branches.data.length > 0 && (
          <Table head={<><Th>Nombre</Th><Th>Dirección</Th><Th>Estado</Th><Th>Alta</Th>{canManage && <Th className="text-right">Acciones</Th>}</>}>
            {branches.data.map((b) => (
              <tr key={b.id}>
                <Td className="font-medium">{b.name}</Td>
                <Td>{b.address ?? '—'}</Td>
                <Td>{b.status === 'active' ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
                <Td>{formatDate(b.createdAt)}</Td>
                {canManage && (
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                      Editar
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nueva sucursal' : 'Editar sucursal'}>
        {editing !== null && <BranchForm branch={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}
