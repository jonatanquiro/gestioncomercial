import { describe, expect, it } from 'vitest';
import { createEmployeeSchema, loginSchema, usernameSchema } from './schemas';

const employee = {
  name: 'Caja',
  password: 'clave-segura-1',
  roleId: '00000000-0000-4000-8000-000000000000',
  branchIds: ['00000000-0000-4000-8000-000000000001'],
};

describe('nombre de usuario', () => {
  it('normaliza y acepta los mismos caracteres que el servidor', () => {
    expect(usernameSchema.parse('  Caja.1_b-2 ')).toBe('caja.1_b-2');
    for (const bad of ['ab', 'con@arroba', 'ñandú', '.punto', 'a'.repeat(31)]) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('el alta de empleado pide usuario o email, y el vacío cuenta como ausente', () => {
    expect(createEmployeeSchema.parse({ ...employee, username: 'caja1', email: '' })).toMatchObject({ username: 'caja1', email: null });
    expect(createEmployeeSchema.parse({ ...employee, email: 'a@b.com' })).toMatchObject({ email: 'a@b.com' });
    const none = createEmployeeSchema.safeParse({ ...employee, username: '', email: '' });
    expect(none.success).toBe(false);
    expect(none.error?.issues[0]?.path).toEqual(['username']);
  });

  it('el ingreso acepta email o usuario en minúsculas', () => {
    expect(loginSchema.parse({ login: ' Caja1 ', password: 'x' }).login).toBe('caja1');
  });
});
