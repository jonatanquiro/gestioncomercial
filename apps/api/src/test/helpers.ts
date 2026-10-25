import { randomInt } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MeResponse, RegisterTenantInput } from '@gc/contracts';
import { Pool } from 'pg';
import { createApp } from '../app';
import { MailerService } from '../modules/mail/mailer.service';

export async function createTestApp(): Promise<NestFastifyApplication> {
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

let seq = 0;
export function uniqueEmail(prefix = 'user') {
  seq += 1;
  return `${prefix}.${Date.now()}.${seq}.${randomInt(1e6)}@test.local`;
}

/** Cliente HTTP de prueba con cookies, CSRF e IP propia (para no compartir límites de intentos). */
export class TestClient {
  cookies = new Map<string, string>();
  readonly ip = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 254)}`;

  constructor(private readonly app: NestFastifyApplication) {}

  async request<T = any>(method: string, url: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = this.cookies.get('gc_csrf');
    if (csrf && opts.csrf !== false && method !== 'GET') headers['x-csrf-token'] = csrf;
    const res = await this.app.inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers,
      payload: body === undefined ? undefined : (body as object),
      remoteAddress: this.ip,
    });
    for (const c of res.cookies as Array<{ name: string; value: string; maxAge?: number }>) {
      if (c.value === '' || c.maxAge === 0) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    let json: T | undefined;
    try {
      json = res.json() as T;
    } catch {
      json = undefined;
    }
    return { status: res.statusCode, body: json as T, headers: res.headers };
  }

  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown, opts?: { csrf?: boolean }) {
    return this.request<T>('POST', url, body ?? {}, opts);
  }
  put<T = any>(url: string, body?: unknown) {
    return this.request<T>('PUT', url, body ?? {});
  }
  delete<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }
}

export const TEST_PASSWORD = 'clave-segura-de-prueba-1';

export async function registerTenant(app: NestFastifyApplication, overrides: Partial<RegisterTenantInput> = {}) {
  const client = new TestClient(app);
  const input = {
    tradeName: `Comercio ${randomInt(1e6)}`,
    taxCondition: 'monotributo',
    businessTypeCode: 'kiosco',
    ownerName: 'Dueña de Prueba',
    email: uniqueEmail('owner'),
    password: TEST_PASSWORD,
    ...overrides,
  };
  const res = await client.post('/auth/register', input);
  if (res.status !== 201) throw new Error(`Registro falló: ${res.status} ${JSON.stringify(res.body)}`);
  const me = await client.get<MeResponse>('/auth/me');
  return { client, input, me: me.body, tenantId: me.body.tenant!.id };
}

/** Crea un empleado con el rol indicado y devuelve un cliente con su sesión iniciada. */
export async function addEmployee(app: NestFastifyApplication, owner: TestClient, roleId: string, branchIds: string[]) {
  const email = uniqueEmail('emp');
  const res = await owner.post('/employees', { name: 'Empleado Prueba', email, password: TEST_PASSWORD, roleId, branchIds });
  if (res.status !== 201) throw new Error(`Alta de empleado falló: ${res.status} ${JSON.stringify(res.body)}`);
  const client = new TestClient(app);
  const login = await client.post('/auth/login', { email, password: TEST_PASSWORD });
  if (login.status !== 200) throw new Error(`Login de empleado falló: ${login.status}`);
  return { client, email, membershipId: res.body.membershipId as string };
}

export function sentMail(app: NestFastifyApplication) {
  return app.get(MailerService).sent;
}

/** Conexión como dueño de la base, solo para verificar invariantes desde las pruebas. */
export function ownerPool() {
  return new Pool({
    connectionString: process.env.TEST_DATABASE_MIGRATION_URL ?? 'postgres://gc_owner:gc_owner@localhost:5432/gestioncomercial_test',
    max: 2,
  });
}

/** CUIT válido aleatorio (prefijo 30) para no chocar entre pruebas. */
export function randomCuit(): string {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `30${String(randomInt(1e8)).padStart(8, '0')}`;
    const mod = 11 - (w.reduce((a, x, i) => a + x * Number(base[i]), 0) % 11);
    if (mod === 10) continue;
    return `${base}${mod === 11 ? 0 : mod}`;
  }
}
