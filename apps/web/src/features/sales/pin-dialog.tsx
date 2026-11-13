import type { PermissionCode, PinAuthorizationInput } from '@gc/contracts';
import { PERMISSIONS } from '@gc/contracts';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { authorizersQuery } from './queries';

/**
 * Autorización en el momento: un encargado elige su nombre y escribe su PIN en la misma
 * pantalla. Si el PIN es incorrecto, el error llega del servidor y se muestra acá.
 */
export function PinDialog({
  permission,
  error,
  loading,
  onAuthorize,
  onCancel,
}: {
  permission: PermissionCode | null;
  error: string | null;
  loading: boolean;
  onAuthorize: (a: PinAuthorizationInput) => void;
  onCancel: () => void;
}) {
  const authorizers = useQuery({ ...authorizersQuery(permission ?? 'sales.void'), enabled: permission !== null });
  const [membershipId, setMembershipId] = useState('');
  const [pin, setPin] = useState('');
  useEffect(() => setPin(''), [error]);
  const list = authorizers.data ?? [];
  const selected = membershipId || list[0]?.membershipId || '';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (selected && /^\d{4,6}$/.test(pin)) onAuthorize({ membershipId: selected, pin });
  }

  return (
    <Dialog
      open={permission !== null}
      onOpenChange={(o) => !o && onCancel()}
      title="Autorización de un encargado"
      description={permission ? `Hace falta autorizar: ${PERMISSIONS[permission].label.toLowerCase()}.` : undefined}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {authorizers.isSuccess && list.length === 0 ? (
          <Alert kind="info">Nadie con este permiso cargó su PIN todavía. Se carga desde Mi cuenta.</Alert>
        ) : (
          <>
            <Field label="Quién autoriza">
              {(p) => (
                <Select {...p} value={selected} onChange={(e) => setMembershipId(e.target.value)}>
                  {list.map((a) => (
                    <option key={a.membershipId} value={a.membershipId}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="PIN">
              {(p) => <Input {...p} type="password" inputMode="numeric" autoComplete="off" maxLength={6} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
            </Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={!selected || pin.length < 4}>
            Autorizar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
