import { CUSTOMER_DOCUMENT_TYPES, CUSTOMER_VAT_CONDITIONS, type CustomerDto, customerSchema, updateCustomerSchema } from '@gc/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { zodFieldErrors } from '@/features/catalog/queries';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { parseDecimalInput, toInputDecimal } from '@/lib/format';
import { useCan } from '@/lib/session';

/** Alta o edición de un cliente. El límite de crédito lo carga quien puede dar crédito. */
export function CustomerForm({ customer, initialName = '', onDone }: { customer?: CustomerDto; initialName?: string; onDone: (saved: CustomerDto) => void }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canCredit = can('accounts.grant_credit');
  const [form, setForm] = useState({
    name: customer?.name ?? initialName,
    documentType: customer?.documentType ? String(customer.documentType) : '96',
    documentNumber: customer?.documentNumber ?? '',
    vatCondition: String(customer?.vatCondition ?? 5),
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    address: customer?.address ?? '',
    notes: customer?.notes ?? '',
    credit: customer?.creditLimit !== null && customer?.creditLimit !== undefined,
    creditLimit: customer?.creditLimit ? toInputDecimal(customer.creditLimit) : '',
    status: customer?.status ?? 'active',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) => (customer ? http.put<CustomerDto>(`/customers/${customer.id}`, body) : http.post<CustomerDto>('/customers', body)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast(customer ? 'Cliente actualizado' : 'Cliente creado');
      onDone(saved);
    },
    onError: (err) => err instanceof ApiRequestError && setErrors(err.fieldErrors()),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const hasDocument = form.documentNumber.trim() !== '';
    const body = {
      name: form.name,
      documentType: hasDocument ? Number(form.documentType) : null,
      documentNumber: hasDocument ? form.documentNumber : null,
      vatCondition: Number(form.vatCondition),
      phone: form.phone,
      email: form.email,
      address: form.address,
      notes: form.notes,
      creditLimit: form.credit ? parseDecimalInput(form.creditLimit) || '0' : null,
      ...(customer ? { status: form.status } : {}),
    };
    const parsed = (customer ? updateCustomerSchema : customerSchema).safeParse(body);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    save.mutate(parsed.data);
  }
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error)}</Alert>}
      <Field label="Nombre y apellido o razón social" error={errors.name}>
        {(p) => <Input {...p} autoFocus value={form.name} onChange={set('name')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr_1fr]">
        <Field label="Documento">
          {(p) => (
            <Select {...p} value={form.documentType} onChange={set('documentType')}>
              {Object.entries(CUSTOMER_DOCUMENT_TYPES).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Número" error={errors.documentNumber} hint="Opcional; para facturarle.">
          {(p) => <Input {...p} inputMode="numeric" value={form.documentNumber} onChange={set('documentNumber')} />}
        </Field>
        <Field label="Condición frente al IVA">
          {(p) => (
            <Select {...p} value={form.vatCondition} onChange={set('vatCondition')}>
              {Object.entries(CUSTOMER_VAT_CONDITIONS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Teléfono" error={errors.phone} hint="Opcional.">{(p) => <Input {...p} type="tel" value={form.phone} onChange={set('phone')} />}</Field>
        <Field label="Email" error={errors.email} hint="Opcional.">{(p) => <Input {...p} type="email" value={form.email} onChange={set('email')} />}</Field>
      </div>
      <Field label="Domicilio" error={errors.address} hint="Opcional; sale en la factura.">{(p) => <Input {...p} value={form.address} onChange={set('address')} />}</Field>
      <Field label="Notas" error={errors.notes} hint="Opcional.">{(p) => <Input {...p} value={form.notes} onChange={set('notes')} />}</Field>
      {canCredit && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 rounded border-slate-300" checked={form.credit} onChange={(e) => setForm({ ...form, credit: e.target.checked })} />
            <span>
              <span className="font-medium">Puede comprar a cuenta corriente</span>
              <span className="block text-slate-500">Se le vende fiado hasta el límite: lo que debe más lo nuevo no puede pasarlo.</span>
            </span>
          </label>
          {form.credit && (
            <Field label="Límite de deuda" error={errors.creditLimit}>
              {(p) => <Input {...p} inputMode="decimal" className="w-48" value={form.creditLimit} onChange={set('creditLimit')} />}
            </Field>
          )}
        </div>
      )}
      {customer && (
        <Field label="Estado">
          {(p) => (
            <Select {...p} className="w-48" value={form.status} onChange={set('status')}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </Select>
          )}
        </Field>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {customer ? 'Guardar cambios' : 'Crear cliente'}
        </Button>
      </div>
    </form>
  );
}
