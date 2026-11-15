import { describe, expect, it } from 'vitest';

const errors = import.meta.glob<{ default: Record<string, string> }>('./*/errors.json', { eager: true });

// The budget file's warnings of a line read after "Line n:" (lot I2 of 26.11.9): a second colon in the
// sentence would read "Line 2: Budget 2026: …".
const AFTER_LINE = ['BUDGET_FILE_AMOUNT_FAR_FROM_LINE', 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER', 'BUDGET_FILE_LOOKALIKE_SAME_LINE'];

describe('budget file warnings of a line', () => {
  it('hold no colon of their own, in every language', () => {
    const files = Object.entries(errors);
    expect(files).toHaveLength(4);
    for (const [path, { default: texts }] of files) {
      for (const code of AFTER_LINE) {
        expect(texts[code], `${path} ${code}`).toBeTypeOf('string');
        expect(texts[code], `${path} ${code}`).not.toMatch(/:/);
      }
    }
  });
});
