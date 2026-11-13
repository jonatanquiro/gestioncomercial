import { brandSchema, type CategoryDto, categorySchema } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { useCan } from '@/lib/session';
import { brandsQuery, categoriesQuery } from './queries';

function CategoryForm({ category, onDone }: { category?: CategoryDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(category?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: () => (category ? http.put(`/categories/${category.id}`, { name, status }) : http.post('/categories', { name })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast(category ? 'Categoría actualizada' : 'Categoría creada');
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = categorySchema.safeParse({ name, status });
    setFieldError(parsed.success ? undefined : parsed.error.issues[0]?.message);
    if (parsed.success) save.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Nombre" error={fieldError}>
        {(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      {category && (
        <Field label="Estado" hint="Una categoría inactiva no se ofrece al cargar productos. Los productos que ya la tienen la conservan.">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}>
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

function BrandForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => http.post('/brands', { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      toast('Marca creada');
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = brandSchema.safeParse({ name });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Nombre inválido');
    save.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Nombre">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
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

export function CategoriesPage() {
  const can = useCan();
  const allowed = can('products.read');
  const canEdit = can('products.update');
  const categories = useQuery({ ...categoriesQuery, enabled: allowed });
  const brands = useQuery({ ...brandsQuery, enabled: allowed });
  const [dialog, setDialog] = useState<CategoryDto | 'new' | 'brand' | null>(null);
  if (!allowed) return <Forbidden />;

  return (
    <>
      <PageHeader
        title="Categorías y marcas"
        description="Las categorías iniciales vienen del rubro del comercio. Podés renombrarlas, agregar otras o desactivar las que no uses."
        actions={
          canEdit && (
            <Button onClick={() => setDialog('new')}>
              <Plus className="size-4" aria-hidden /> Nueva categoría
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {categories.isLoading && <Spinner />}
          {categories.error && <div className="p-4"><Alert>{errorMessage(categories.error)}</Alert></div>}
          {categories.data?.length === 0 && <EmptyState>Todavía no hay categorías.</EmptyState>}
          {categories.data && categories.data.length > 0 && (
            <Table head={<><Th>Categoría</Th><Th className="text-right">Productos activos</Th><Th>Estado</Th><Th className="text-right">Acciones</Th></>}>
              {categories.data.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="text-right">{c.productCount}</Td>
                  <Td>{c.status === 'active' ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
                  <Td className="text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog(c)}>
                        Editar
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Marcas</h2>
            {(can('products.create') || canEdit) && (
              <Button size="sm" variant="secondary" onClick={() => setDialog('brand')}>
                <Plus className="size-4" aria-hidden /> Nueva
              </Button>
            )}
          </div>
          {brands.data?.length === 0 && <p className="text-sm text-slate-500">Todavía no hay marcas. También podés crearlas desde la ficha del producto.</p>}
          <ul className="divide-y divide-slate-100 text-sm">
            {(brands.data ?? []).map((b) => (
              <li key={b.id} className="py-2">
                {b.name}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'new' ? 'Nueva categoría' : dialog === 'brand' ? 'Nueva marca' : 'Editar categoría'}
      >
        {dialog === 'new' && <CategoryForm onDone={() => setDialog(null)} />}
        {dialog === 'brand' && <BrandForm onDone={() => setDialog(null)} />}
        {dialog && typeof dialog === 'object' && <CategoryForm key={dialog.id} category={dialog} onDone={() => setDialog(null)} />}
      </Dialog>
    </>
  );
}
