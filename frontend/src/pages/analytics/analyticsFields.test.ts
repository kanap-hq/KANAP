import { describe, expect, it } from 'vitest';
import { DIMENSION_CODE_PATTERN, proposeDimensionCode } from './analyticsFields';

describe('proposeDimensionCode', () => {
  it('lowercases, strips accents and turns spaces into dashes', () => {
    expect(proposeDimensionCode('Nature de coût')).toBe('nature-de-cout');
    expect(proposeDimensionCode('  Centre   analytique ')).toBe('centre-analytique');
  });

  it('spells out letters that carry no separate accent', () => {
    expect(proposeDimensionCode('Œuvres')).toBe('oeuvres');
    expect(proposeDimensionCode('Straße')).toBe('strasse');
    expect(proposeDimensionCode('Cæsar')).toBe('caesar');
    expect(proposeDimensionCode('Ørsted')).toBe('orsted');
  });

  it('drops other characters and never starts or ends with a separator', () => {
    expect(proposeDimensionCode('- R&D / projets -')).toBe('rd-projets');
    const long = proposeDimensionCode(`${'a'.repeat(39)} b`);
    expect(long).toBe('a'.repeat(39));
    expect(proposeDimensionCode(`${'a'.repeat(39)}_b`)).toBe('a'.repeat(39));
  });

  it('proposes codes the server accepts', () => {
    for (const name of ['Nature de coût', 'Œuvres', 'Straße', `${'x'.repeat(60)}`, 'Ordre interne 2027']) {
      expect(proposeDimensionCode(name)).toMatch(DIMENSION_CODE_PATTERN);
    }
  });
});
