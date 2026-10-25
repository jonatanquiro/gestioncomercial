import { describe, expect, it } from 'vitest';
import { roundMoney } from './money';
import * as pricing from './pricing';
import data from './pricing-cases.json';

const fns: Record<string, (...args: never[]) => string> = { ...pricing, roundMoney };

describe('casos compartidos con el servidor PHP (pricing-cases.json)', () => {
  for (const c of data.cases) {
    it(`${c.fn}(${c.args.join(', ')}) = ${c.expected}`, () => {
      const fn = fns[c.fn];
      expect(fn, `función inexistente: ${c.fn}`).toBeTypeOf('function');
      expect((fn as (...a: unknown[]) => string)(...c.args)).toBe(c.expected);
    });
  }
});
