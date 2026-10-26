import { describe, expect, it } from 'vitest';
import { lifecyclePillLabel } from './AssetWorkspacePage';

describe('lifecyclePillLabel', () => {
  it('shows the catalog label unchanged, accents included', () => {
    expect(lifecyclePillLabel('Obsolète', 'end_of_life', 'Not set')).toBe('Obsolète');
    // A label that is the code itself still goes through spacing, without a capital after an accent.
    expect(lifecyclePillLabel('Obsolète', 'Obsolète', 'Not set')).toBe('Obsolète');
  });

  it('spaces a code the catalog does not rename', () => {
    expect(lifecyclePillLabel('end_of_life', 'end_of_life', 'Not set')).toBe('End Of Life');
    expect(lifecyclePillLabel('', 'end_of_life', 'Not set')).toBe('End Of Life');
    expect(lifecyclePillLabel('  ', null, 'Not set')).toBe('Not set');
  });
});
