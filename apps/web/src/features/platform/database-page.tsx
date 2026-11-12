import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { ApiRequestError, errorMessage, http } from '@/lib/api';

interface DatabaseState {
  server: string;
  supported: boolean;
  pending: string[];
  applied: number;
}

/** «2026_11_04_000006_precio_de_contado» → «04/11/2026 · precio de contado». */
const describe = (name: string) => {
  const m = /^(\d{4})_(\d{2})_(\d{2})_\d{6}_(.+)$/.exec(name);
  return m ? `${m[3]}/${m[2]}/${m[1]} · ${m[4]!.replace(/_/g, ' ')}` : name;
};

/**
 * Actualizar la base sin consola (ADR 0026): en hostings sin SSH, como Ferozo, después de subir
 * los archivos nuevos se aplican desde acá las migraciones pendientes.
 */
export function PlatformDatabasePage() {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ['platform', 'database'], queryFn: () => http.get<DatabaseState>('/platform/database') });
  const [backup, setBackup] = useState(false);
  const migrate = useMutation({
    mutationFn: () => http.post<DatabaseState & { ran: string[]; output: string }>('/platform/database/migrate', { confirm: true }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['platform', 'database'] }),
  });
  const failure = migrate.error instanceof ApiRequestError ? (migrate.error.details as { ran?: string[]; output?: string } | undefined) : undefined;
  const s = state.data;

  return (
    <>
      <PageHeader title="Base de datos" description="Después de subir una versión nueva, aplicá acá los cambios de la base. Sirve en hostings sin consola, como Ferozo." />
      {state.isLoading && <Spinner />}
      {state.error && <Alert>{errorMessage(state.error)}</Alert>}
      {s && (
        <Card className="max-w-3xl space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Database className="size-5 text-slate-500" aria-hidden />
            <span className="font-semibold">{s.server}</span>
            {s.supported ? <Badge tone="green">Compatible</Badge> : <Badge tone="red">No compatible</Badge>}
            <span className="text-sm text-slate-500">{s.applied} cambios aplicados</span>
          </div>
          {!s.supported && <Alert>Esta base no admite los cambios del sistema: hace falta MariaDB 10.2 o MySQL 8.0.19 en adelante. Consultá con el hosting antes de seguir.</Alert>}

          {migrate.data && (
            <Alert kind="success">
              Listo: se aplicaron {migrate.data.ran.length} cambio(s). {migrate.data.pending.length === 0 ? 'La base está al día.' : `Quedan ${migrate.data.pending.length} pendientes.`}
            </Alert>
          )}
          {migrate.error && (
            <div className="space-y-2">
              <Alert>{errorMessage(migrate.error)}</Alert>
              {failure?.ran && failure.ran.length > 0 && <p className="text-sm">Se llegaron a aplicar: {failure.ran.map(describe).join(', ')}.</p>}
              {failure?.output && <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{failure.output}</pre>}
            </div>
          )}

          {s.pending.length === 0 ? (
            <p className="text-sm text-slate-600">La base está al día: no hay cambios pendientes.</p>
          ) : (
            <>
              <div>
                <p className="mb-2 text-sm font-semibold">{s.pending.length} cambio(s) pendiente(s)</p>
                <ul className="max-h-72 space-y-1 overflow-auto rounded-lg border border-slate-200 p-3 font-mono text-xs">
                  {s.pending.map((p) => (
                    <li key={p}>{describe(p)}</li>
                  ))}
                </ul>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
                <span>Hice un respaldo de la base (phpMyAdmin del hosting → Exportar) y lo guardé en mi PC.</span>
              </label>
              <Button className="h-12" disabled={!s.supported || !backup} loading={migrate.isPending} onClick={() => migrate.mutate()}>
                <Database className="size-4" /> Actualizar base de datos
              </Button>
              <p className="text-xs text-slate-500">Puede tardar unos segundos. No cierres la página mientras se actualiza.</p>
            </>
          )}
        </Card>
      )}
    </>
  );
}
