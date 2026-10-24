import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptSecret } from '../common/crypto';
import { uuidv7 } from '../common/ids';
import { DbService } from '../db/db.service';
import { platformUsers } from '../db/schema';
import { createTestApp, registerTenant, TestClient, uniqueEmail } from './helpers';

let app: NestFastifyApplication;
const secret = authenticator.generateSecret();
const email = uniqueEmail('admin');
const password = 'clave-de-plataforma-segura';

async function platformLogin() {
  const c = new TestClient(app);
  const res = await c.post('/platform/auth/login', { email, password, totp: authenticator.generate(secret) });
  expect(res.status).toBe(200);
  return c;
}

beforeAll(async () => {
  app = await createTestApp();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await app.get(DbService).platform((tx) =>
    tx.insert(platformUsers).values({ id: uuidv7(), email, name: 'Admin Plataforma', passwordHash, totpSecretEnc: encryptSecret(secret) }),
  );
});
afterAll(async () => {
  await app.close();
});

describe('panel de plataforma', () => {
  it('exige contraseña y código TOTP', async () => {
    const c = new TestClient(app);
    expect((await c.post('/platform/auth/login', { email, password, totp: '000000' })).status).toBe(401);
    expect((await c.post('/platform/auth/login', { email, password: 'incorrecta-123', totp: authenticator.generate(secret) })).status).toBe(401);
    const ok = await platformLogin();
    expect((await ok.get('/platform/auth/me')).body.name).toBe('Admin Plataforma');
    // La sesión de plataforma no sirve para operar un comercio.
    expect((await ok.get('/tenant')).status).toBe(401);
  });

  it('lista comercios con uso agregado y sin datos comerciales', async () => {
    const owner = await registerTenant(app, { tradeName: 'Visible en plataforma' });
    const admin = await platformLogin();
    const res = await admin.get(`/platform/tenants?q=${encodeURIComponent('Visible en plataforma')}`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((t: { id: string }) => t.id === owner.tenantId);
    expect(row).toMatchObject({ userCount: 1, branchCount: 1, planCode: 'inicial', subscriptionStatus: 'trialing' });
  });

  it('suspende y reactiva un comercio; el comercio ve la acción en su auditoría', async () => {
    const owner = await registerTenant(app);
    const admin = await platformLogin();
    const suspend = await admin.post(`/platform/tenants/${owner.tenantId}/status`, { status: 'suspended', reason: 'Falta de pago' });
    expect(suspend.status).toBe(200);

    const blocked = await owner.client.get('/tenant');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TENANT_SUSPENDED');
    expect((await owner.client.get('/auth/me')).status).toBe(200);

    await admin.post(`/platform/tenants/${owner.tenantId}/status`, { status: 'active', reason: 'Pago acreditado' });
    expect((await owner.client.get('/tenant')).status).toBe(200);
    const audit = (await owner.client.get('/audit?entityType=tenant')).body.items.map((i: { action: string }) => i.action);
    expect(audit).toEqual(expect.arrayContaining(['platform.tenant_suspended', 'platform.tenant_activated']));
  });

  it('edita precio, límites y funciones de un plan, con auditoría', async () => {
    const admin = await platformLogin();
    const plans = (await admin.get('/platform/plans')).body as Array<{ id: string; code: string; limits: Record<string, number> }>;
    const pro = plans.find((p) => p.code === 'profesional')!;
    const res = await admin.put(`/platform/plans/${pro.id}`, {
      name: 'Profesional',
      price: '24999.90',
      trialDays: 30,
      active: true,
      limits: { ...pro.limits, max_users: 12 },
      features: ['fiscal_arca', 'advanced_reports'],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ price: '24999.90', trialDays: 30, limits: { max_users: 12 } });
    const audit = (await admin.get('/platform/audit')).body.items.map((i: { action: string }) => i.action);
    expect(audit).toContain('platform.plan_updated');
  });

  it('valida los datos del plan', async () => {
    const admin = await platformLogin();
    const plans = (await admin.get('/platform/plans')).body as Array<{ id: string }>;
    const res = await admin.put(`/platform/plans/${plans[0]!.id}`, { name: 'x', price: '12,50', trialDays: -1, active: true, limits: {}, features: [] });
    expect(res.status).toBe(400);
  });
});
