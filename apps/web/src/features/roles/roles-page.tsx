import { PERMISSIONS, type PermissionCode, type RoleDto } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { useCan, useMe } from '@/lib/session';

const MODULES = Object.entries(PERMISSIONS).reduce<Record<string, PermissionCode[]>>((acc, [code, p]) => {
  (acc[p.module] ??= []).push(code as PermissionCode);
  return acc;
}, {});

function RoleEditor({ role, onDone }: { role: RoleDto | null; onDone: () => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? '');
  const [selected, setSelected] = useState<Set<PermissionCode>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  const mine = new Set(me.permissions);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), permissions: [...selected] };
      return role ? http.put(`/roles/${role.id}`, body) : http.post('/roles', body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast(role ? 'Rol actualizado' : 'Rol creado');
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const toggle = (code: PermissionCode) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError('El nombre es obligatorio');
        save.mutate();
      }}
      className="space-y-4"
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Nombre del rol">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />}</Field>
      <p className="text-xs text-slate-500">Solo podés otorgar o quitar permisos que vos mismo tenés.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(MODULES).map(([module, codes]) => (
          <fieldset key={module} className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">{module}</legend>
            <div className="space-y-1.5">
              {codes.map((code) => (
                <label key={code} className={`flex items-start gap-2 text-sm ${mine.has(code) ? '' : 'text-slate-400'}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 rounded border-slate-300"
                    checked={selected.has(code)}
                    disabled={!mine.has(code)}
                    onChange={() => toggle(code)}
                  />
                  {PERMISSIONS[code].label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={save.isPending}>
          Guardar rol
        </Button>
      </div>
    </form>
  );
}

export function RolesPage() {
  const can = useCan();
  const allowed = can('roles.manage');
  const queryClient = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => http.get<RoleDto[]>('/roles'), enabled: allowed });
  const [editing, setEditing] = useState<RoleDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleDto | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => http.delete(`/roles/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast('Rol eliminado');
      setDeleting(null);
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (!allowed) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="Roles y permisos"
        description="Los roles agrupan permisos. Copiá o ajustá las plantillas según cómo trabaja tu comercio."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Nuevo rol
          </Button>
        }
      />
      {roles.isLoading && <Spinner />}
      {roles.error && <Alert>{errorMessage(roles.error)}</Alert>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.data?.map((r) => (
          <Card key={r.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{r.name}</h2>
              {r.isSystem && <Badge tone="brand">Sistema</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {r.permissions.length} permisos · {r.memberCount} {r.memberCount === 1 ? 'persona' : 'personas'}
            </p>
            <div className="mt-auto flex gap-2 pt-4">
              {!r.isSystem && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                    Eliminar
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nuevo rol' : 'Editar rol'} wide>
        {editing !== null && <RoleEditor role={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} title="Eliminar rol" description={`¿Eliminar el rol "${deleting?.name}"? Esta acción queda registrada en la auditoría.`}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            Cancelar
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
            Eliminar
          </Button>
        </div>
      </Dialog>
    </>
  );
}
