import { describe, expect, it } from 'vitest';
import { addReferenceProductsSchema } from './schemas';

describe('stock inicial desde el catálogo', () => {
  const parse = (initialStock: unknown) => addReferenceProductsSchema.safeParse({
    categoryId: null,
    items: [{ code: '7791234567890', price: '1500', initialStock }],
  });

  it('permite cantidades enteras y mantiene el stock opcional', () => {
    for (const stock of [undefined, null, '0', '12', '12.000', '99999999999']) {
      expect(parse(stock).success).toBe(true);
    }
  });

  it('rechaza cantidades negativas, fraccionarias o fuera de rango en el campo de stock', () => {
    for (const stock of ['-1', '1.5', '1.2345', 'abc', '100000000000', 5]) {
      const result = parse(stock);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(['items', 0, 'initialStock']);
    }
  });
});
