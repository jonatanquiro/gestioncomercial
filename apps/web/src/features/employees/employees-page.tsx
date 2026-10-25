import { zodResolver } from '@hookform/resolvers/zod';
import { type BranchDto, createEmployeeSchema, type EmployeeDto, type RoleDto, updateMembershipSchema } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { type FieldError, useForm, type UseFormRegister } from 'react-hook-form';
import type { z } from 'zod';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { useCan, useMe } from '@/lib/session';

function friendly(err: unknown) {
  if (err instanceof ApiRequestError && err.code === 'PLAN_LIMIT_REACHED') return 'Tu plan no permite más usuarios activos.';
  return errorMessage(err);
}

function BranchChecks({ branches, register, error }: { branches: BranchDto[]; register: UseFormRegister<any>; error?: FieldError | { message?: string } }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">Sucursales donde opera</legend>
      {branches
        .filter((b) => b.status === 'active')
        .map((b) => (
          <label key={b.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" value={b.id} className="size-4 rounded border-slate-300" {...register('branchIds')} />
            {b.name}
          </label>
        ))}
      {error?.message && <p className="text-sm text-red-600">{error.message}</p>}
    </fieldset>
  );
}

function CreateEmployee({ roles, branches, onDone }: { roles: RoleDto[]; branches: BranchDto[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const defaultBranch = branches.find((b) => b.status === 'active')?.id;
  const { register, handleSubmit, formState } = useForm<z.input<typeof createEmployeeSchema>, unknown, z.output<typeof createEmployeeSchema>>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: { roleId: roles.find((r) => r.templateCode === 'cashier')?.id ?? '', branchIds: defaultBranch ? [defaultBranch] : [] },
  });
  const save = useMutation({
    mutationFn: (v: z.output<typeof createEmployeeSchema>) => http.post<{ existingUser: boolean }>('/employees', v),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast(res.existingUser ? 'La persona ya tenía cuenta: se sumó al comercio con su contraseña actual' : 'Empleado creado');
      onDone();
    },
    onError: (err) => setError(friendly(err)),
  });
  const e = formState.errors;
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Nombre y apellido" error={e.name?.message}>
        {(p) => <Input {...p} autoFocus {...register('name')} />}
      </Field>
      <Field label="Email" error={e.email?.message}>
        {(p) => <Input {...p} type="email" autoComplete="off" {...register('email')} />}
      </Field>
      <Field label="Contraseña inicial" error={e.password?.message} hint="Compartila en persona. La persona puede cambiarla desde Mi cuenta.">
        {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}
      </Field>
      <Field label="Rol" error={e.roleId?.message}>
        {(p) => (
          <Select {...p} {...register('roleId')}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <BranchChecks branches={branches} register={register} error={e.branchIds} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={save.isPending}>
          Crear empleado
        </Button>
      </div>
    </form>
  );
}

function EditEmployee({ employee, roles, branches, onDone }: { employee: EmployeeDto; roles: RoleDto[]; branches: BranchDto[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.input<typeof updateMembershipSchema>, unknown, z.output<typeof updateMembershipSchema>>({
    resolver: zodResolver(updateMembershipSchema),
    defaultValues: { roleId: employee.roleId, branchIds: employee.branchIds, status: employee.status },
  });
  const save = useMutation({
    mutationFn: (v: z.output<typeof updateMembershipSchema>) => http.put(`/employees/${employee.membershipId}`, v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast('Cambios guardados');
      onDone();
    },
    onError: (err) => setError(friendly(err)),
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-slate-600">
        {employee.name} · {employee.email}
      </p>
      <Field label="Rol" error={formState.errors.roleId?.message}>
        {(p) => (
          <Select {...p} {...register('roleId')}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <BranchChecks branches={branches} register={register} error={formState.errors.branchIds} />
      <Field label="Estado" hint="Un usuario inactivo no puede ingresar a este comercio. Sus operaciones anteriores se conservan.">
        {(p) => (
          <Select {...p} {...register('status')}>
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </Select>
        )}
      </Field>
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

export function EmployeesPage() {
  const can = useCan();
  const me = useMe();
  const allowed = can('users.manage');
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => http.get<EmployeeDto[]>('/employees'), enabled: allowed });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => http.get<RoleDto[]>('/roles'), enabled: allowed });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => http.get<BranchDto[]>('/branches'), enabled: allowed });
  const [dialog, setDialog] = useState<EmployeeDto | 'new' | null>(null);
  const [search, setSearch] = useState('');

  if (!allowed) return <Forbidden />;
  const ready = employees.data && roles.data && branches.data;
  const branchName = (id: string) => branches.data?.find((b) => b.id === id)?.name ?? '—';
  // La lista está acotada por el límite de usuarios del plan, así que se filtra en el navegador.
  const term = search.trim().toLocaleLowerCase('es-AR');
  const visible = (employees.data ?? []).filter(
    (e) => !term || [e.name, e.email, e.roleName].some((v) => v.toLocaleLowerCase('es-AR').includes(term)),
  );

  return (
    <>
      <PageHeader
        title="Empleados"
        description="Usuarios que operan en este comercio, con su rol y sucursales."
        actions={
          <Button onClick={() => setDialog('new')} disabled={!ready}>
            <Plus className="size-4" aria-hidden /> Nuevo empleado
          </Button>
        }
      />
      {ready && employees.data.length > 0 && (
        <div className="mb-4">
          <Input
            type="search"
            aria-label="Buscar por nombre, email o rol"
            placeholder="Buscar por nombre, email o rol"
            className="sm:w-80"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <Card>
        {!ready && !employees.error && <Spinner />}
        {employees.error && <div className="p-4"><Alert>{errorMessage(employees.error)}</Alert></div>}
        {ready && employees.data.length === 0 && <EmptyState>Todavía no hay empleados.</EmptyState>}
        {ready && employees.data.length > 0 && visible.length === 0 && <EmptyState>Ningún empleado coincide con la búsqueda.</EmptyState>}
        {ready && visible.length > 0 && (
          <Table head={<><Th>Nombre</Th><Th>Rol</Th><Th>Sucursales</Th><Th>Estado</Th><Th className="text-right">Acciones</Th></>}>
            {visible.map((e) => (
              <tr key={e.membershipId}>
                <Td>
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-slate-500">{e.email}</div>
                </Td>
                <Td>{e.roleName}</Td>
                <Td>{e.branchIds.map(branchName).join(', ')}</Td>
                <Td>{e.status === 'active' ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
                <Td className="text-right">
                  {e.userId !== me.user.id && (
                    <Button size="sm" variant="ghost" onClick={() => setDialog(e)}>
                      Editar
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)} title={dialog === 'new' ? 'Nuevo empleado' : 'Editar empleado'}>
        {ready && dialog === 'new' && <CreateEmployee roles={roles.data} branches={branches.data} onDone={() => setDialog(null)} />}
        {ready && dialog && dialog !== 'new' && (
          <EditEmployee employee={dialog} roles={roles.data} branches={branches.data} onDone={() => setDialog(null)} />
        )}
      </Dialog>
    </>
  );
}
