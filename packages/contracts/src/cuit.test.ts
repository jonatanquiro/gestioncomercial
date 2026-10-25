import { describe, expect, it } from 'vitest';
import { isValidCuit } from './cuit';
import { ROLE_TEMPLATES } from './roles';
import { isPermissionCode } from './permissions';

describe('isValidCuit', () => {
  it('acepta CUIT válidos con y sin guiones', () => {
    expect(isValidCuit('20-12345678-6')).toBe(true);
    expect(isValidCuit('30712345671')).toBe(true);
    expect(isValidCuit('27-11111111-5')).toBe(false); // el verificador correcto es 7
  });
  it('rechaza longitudes incorrectas', () => {
    expect(isValidCuit('2012345678')).toBe(false);
    expect(isValidCuit('abc')).toBe(false);
  });
});

describe('ROLE_TEMPLATES', () => {
  it('solo usa permisos del catálogo', () => {
    for (const role of ROLE_TEMPLATES) {
      for (const p of role.permissions) expect(isPermissionCode(p)).toBe(true);
    }
  });
  it('solo el propietario gestiona la suscripción', () => {
    const holders = ROLE_TEMPLATES.filter((r) => r.permissions.includes('subscription.manage')).map((r) => r.code);
    expect(holders).toEqual(['owner']);
  });
});
