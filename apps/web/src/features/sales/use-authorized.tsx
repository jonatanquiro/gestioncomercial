import type { PermissionCode } from '@gc/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { PinDialog } from './pin-dialog';
import { type Authorization, needsAuthorization } from './queries';

/** Repite el pedido con el PIN de un encargado cuando el servidor lo pide. */
export function useAuthorized<T>(send: (a: Authorization) => Promise<T>, onSuccess: (r: T) => void) {
  const [pin, setPin] = useState<{ permission: PermissionCode; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: send,
    onSuccess: (r) => (setPin(null), onSuccess(r)),
    onError: (err) => {
      const permission = needsAuthorization(err);
      if (permission) return setPin({ permission, error: err instanceof ApiRequestError && err.code === 'AUTHORIZATION_INVALID' ? err.message : null });
      setPin(null);
      setError(err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR' ? Object.values(err.fieldErrors())[0] ?? err.message : errorMessage(err));
    },
  });
  const dialog = (
    <PinDialog permission={pin?.permission ?? null} error={pin?.error ?? null} loading={mutation.isPending} onAuthorize={(a) => mutation.mutate(a)} onCancel={() => setPin(null)} />
  );
  return { mutation, error, setError, dialog, waitingPin: pin !== null };
}

