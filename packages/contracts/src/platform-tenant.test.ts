import { describe, expect, it } from 'vitest';
import { platformCreateTenantSchema } from './schemas';

describe('contraseña inicial del dueño desde plataforma', () => {
  const parse = (ownerPassword: unknown) => platformCreateTenantSchema.safeParse({
    tradeName: 'Kiosco Central', taxCondition: 'monotributo', businessTypeCode: 'kiosco', planCode: 'inicial',
    ownerName: 'Dueño', ownerEmail: 'dueno@example.com', ownerPassword,
  });

  it('mantiene la invitación opcional y conserva la contraseña escrita sin recortarla', () => {
    for (const value of [undefined, null, '', ' clave-inicial-del-kiosco ']) {
      const result = parse(value);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.ownerPassword).toBe(value);
    }
  });

  it('valida longitud y tipo de la contraseña en su campo', () => {
    for (const value of ['corta', 'a'.repeat(129), 1234567890]) {
      const result = parse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(['ownerPassword']);
    }
  });
});
