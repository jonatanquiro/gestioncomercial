import { type Appearance, type TenantDto, appearanceSchema } from '@gc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { Forbidden } from '@/features/layout/app-layout';
import { errorMessage, http } from '@/lib/api';
import { SettingsTabs } from '@/features/settings/settings-tabs';
import { useCan } from '@/lib/session';
import { appearanceStyle, DEFAULT_APPEARANCE } from './appearance';

export function AppearancePage() {
  const allowed = useCan()('settings.manage');
  const query = useQuery({ queryKey: ['tenant'], queryFn: () => http.get<TenantDto>('/tenant'), enabled: allowed });
  if (!allowed) return <Forbidden />;
  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <Alert>{errorMessage(query.error)}</Alert>;
  return <AppearanceForm tenant={query.data} />;
}

function AppearanceForm({ tenant }: { tenant: TenantDto }) {
  const [form, setForm] = useState<Appearance>({ ...DEFAULT_APPEARANCE, ...tenant.appearance });
  const [error, setError] = useState('');
  const client = useQueryClient();
  const toast = useToast();
  const set = <K extends keyof Appearance>(key: K, value: Appearance[K]) => setForm(prev => ({ ...prev, [key]: value }));
  const save = useMutation({ mutationFn: () => http.put<TenantDto>('/tenant/appearance', appearanceSchema.parse(form)), onSuccess: data => { client.setQueryData(['tenant'], data); toast('Apariencia guardada para este comercio'); }, onError: err => setError(errorMessage(err)) });
  return <>
    <PageHeader title="Apariencia del kiosco" description="Tu logo, tus colores y una forma cómoda de trabajar. Se aplica a todos los usuarios de este comercio." />
      <SettingsTabs />
    <form onSubmit={e => { e.preventDefault(); setError(''); save.mutate(); }} className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-5 p-6">{error && <Alert>{error}</Alert>}
        <Field label="Logo (PNG, JPEG o WebP; hasta 250 KB)">{p => <Input {...p} type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 250000) return setError('El logo debe pesar hasta 250 KB'); setError(''); const reader = new FileReader(); reader.onload = () => set('logoData', String(reader.result)); reader.onerror = () => setError('No se pudo leer el logo'); reader.readAsDataURL(file); }} />}</Field>
        {form.logoData && <div className="flex items-center gap-4"><img src={form.logoData} alt="Logo elegido" className="h-16 max-w-40 object-contain" /><Button size="sm" variant="ghost" onClick={() => set('logoData', null)}>Quitar logo</Button></div>}
        <div className="grid grid-cols-2 gap-4"><Field label="Color principal" hint="Un tono oscuro para que los botones sean legibles.">{p => <Input {...p} type="color" value={form.primaryColor} onChange={e => set('primaryColor', e.target.value)} />}</Field><Field label="Color del menú">{p => <Input {...p} type="color" value={form.menuColor} onChange={e => set('menuColor', e.target.value)} />}</Field></div>
        <Field label="Fuente">{p => <Select {...p} value={form.font} onChange={e => set('font', e.target.value as Appearance['font'])}><option value="system">Sistema · clara y familiar</option><option value="archivo">Archivo · moderna</option><option value="serif">Georgia · clásica</option></Select>}</Field>
        <Field label="Ubicación del menú">{p => <Select {...p} value={form.navigation} onChange={e => set('navigation', e.target.value as Appearance['navigation'])}><option value="side">Lateral</option><option value="top">Superior</option></Select>}</Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Tamaño de texto">{p => <Select {...p} value={form.textSize} onChange={e => set('textSize', e.target.value as Appearance['textSize'])}><option value="normal">Normal</option><option value="large">Grande</option></Select>}</Field><Field label="Tablas">{p => <Select {...p} value={form.density} onChange={e => set('density', e.target.value as Appearance['density'])}><option value="normal">Espaciado normal</option><option value="compact">Compactas</option></Select>}</Field></div>
        <div className="flex flex-wrap gap-3"><Button type="submit" loading={save.isPending}>Guardar apariencia</Button><Button variant="secondary" onClick={() => setForm({ ...DEFAULT_APPEARANCE })}>Restaurar valores originales</Button></div>
      </Card>
      <div><h2 className="mb-3 text-sm font-semibold">Vista previa</h2><div style={appearanceStyle(form)} className="overflow-hidden rounded-xl border border-slate-200 bg-white font-sans">
        <div className="flex items-center gap-3 bg-slate-950 p-5 text-white">{form.logoData && <img src={form.logoData} alt="" className="h-10 max-w-24 object-contain" />}<span className="font-display font-semibold">{tenant.tradeName}</span></div>
        <div className={form.navigation === 'side' ? 'flex min-h-72' : 'min-h-72'}><div style={{ background: form.menuColor, color: 'var(--menu-foreground)' }} className={`p-4 text-sm ${form.navigation === 'side' ? 'w-32 shrink-0 space-y-5' : 'flex gap-5'}`}><p>Inicio</p><p>Ventas</p><p>Productos</p></div><div className="flex-1 space-y-4 p-6" style={{ fontSize: form.textSize === 'large' ? 18 : 16 }}><h3 className="font-display text-xl font-semibold">Tu comercio, a tu manera</h3><p className="text-sm text-slate-500">Esta vista es una muestra del diseño que vas a guardar.</p><Button>Nueva venta</Button></div></div>
      </div><p className="mt-3 text-xs leading-relaxed text-slate-500">El logo también aparece en el ticket interno. La personalización no modifica los datos, los permisos ni el panel de plataforma. «Restaurar» prepara los valores originales; guardá para aplicarlos.</p></div>
    </form>
  </>;
}
